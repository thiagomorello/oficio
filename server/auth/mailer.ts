// E-mail via SendGrid (fetch, sem SDK). Nunca lança: devolve { sent:false } se algo falhar ou não estiver configurado.
import { accentPalette, DEFAULT_BRANDING, DEFAULT_LOCALE, type BrandingConfig, type Locale } from '../../shared/branding';
import { tFor, type MessageKey, type Params } from '../../shared/i18n';
import type { ServerConfig } from '../config';
import { errMsg, log } from '../log';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  /** SENDGRID_API_KEY e MAIL_FROM definidos? */
  configured: boolean;
  sendMail(msg: MailMessage): Promise<{ sent: boolean }>;
}

export function createMailer(config: Pick<ServerConfig, 'mail'> & Partial<Pick<ServerConfig, 'branding'>>, fetchImpl: typeof fetch = fetch): Mailer {
  const { sendgridApiKey: key, from } = config.mail;
  const fromName = config.branding?.appName ?? DEFAULT_BRANDING.appName;
  const configured = !!key && !!from;
  return {
    configured,
    async sendMail(msg) {
      if (!configured) return { sent: false };
      try {
        const res = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: msg.to }] }],
            from: { email: from, name: fromName },
            subject: msg.subject,
            content: [
              { type: 'text/plain', value: msg.text },
              { type: 'text/html', value: msg.html },
            ],
          }),
        });
        if (!res.ok) {
          log.warn(`SendGrid responded ${res.status}`);
          return { sent: false };
        }
        return { sent: true };
      } catch (err) {
        log.warn(`Failed to send e-mail: ${errMsg(err)}`);
        return { sent: false };
      }
    },
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(brand: BrandingConfig, locale: Locale, title: string, bodyHtml: string, button?: { href: string; label: string }): string {
  const pal = accentPalette(brand.accentColor);
  const btn = button
    ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="display:inline-block;background:${pal.strong};color:${pal.on};font-weight:500;text-decoration:none;padding:12px 20px;border-radius:8px">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#121212;font-family:Poppins,Arial,sans-serif;color:#c8c5ca">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" style="max-width:480px;background:#201f23;border-radius:8px;border-top:4px solid ${pal.accent}"><tr><td style="padding:32px">
<div style="font-size:20px;font-weight:600;color:${pal.accent};letter-spacing:.5px">${esc(brand.appName)}</div>
<h1 style="font-size:20px;font-weight:600;color:#fff;margin:16px 0 8px">${esc(title)}</h1>
<div style="font-size:14px;line-height:1.6">${bodyHtml}</div>${btn}
<p style="font-size:12px;color:#a0aec0;margin:24px 0 0">${esc(brand.appName)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export interface MailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Textos em shared/i18n/messages/server.ts (`server.mail.*`); `locale` = idioma de quem recebe (padrão: en). */
export const templates = {
  /** Convite de novo usuário com senha temporária (troca obrigatória no primeiro acesso). */
  invite(tempPassword: string, loginUrl?: string, brand: BrandingConfig = DEFAULT_BRANDING, locale: Locale = DEFAULT_LOCALE): MailTemplate {
    const url = loginUrl ?? '';
    const t = (key: MessageKey, params?: Params) => tFor(locale, key, params);
    const appName = brand.appName;
    return {
      subject: t('server.mail.invite.subject', { appName }),
      html: layout(
        brand,
        locale,
        t('server.mail.invite.title', { appName }),
        `<p>${esc(t('server.mail.invite.intro'))}</p><p style="font-size:18px;font-weight:600;color:#fff;letter-spacing:1px;background:#33333a;display:inline-block;padding:8px 14px;border-radius:6px">${esc(tempPassword)}</p><p>${esc(t('server.mail.invite.changeNotice'))}</p>`,
        url ? { href: url, label: t('server.mail.invite.button') } : undefined,
      ),
      text: [
        t('server.mail.invite.textGreeting', { appName }),
        '',
        t('server.mail.invite.textPassword', { password: tempPassword }),
        ...(url ? [t('server.mail.invite.textLogin', { url })] : []),
        t('server.mail.invite.textNotice'),
      ].join('\n'),
    };
  },
  /** Redefinição de senha por link (válido por 1 hora). */
  reset(link: string, brand: BrandingConfig = DEFAULT_BRANDING, locale: Locale = DEFAULT_LOCALE): MailTemplate {
    const t = (key: MessageKey, params?: Params) => tFor(locale, key, params);
    return {
      subject: t('server.mail.reset.subject', { appName: brand.appName }),
      html: layout(brand, locale, t('server.mail.reset.title'), `<p>${esc(t('server.mail.reset.intro'))}</p>`, { href: link, label: t('server.mail.reset.button') }),
      text: t('server.mail.reset.text', { link }),
    };
  },
};
