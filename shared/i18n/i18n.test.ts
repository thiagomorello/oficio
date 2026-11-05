import { describe, expect, it } from 'vitest';
import { defineMessages, interpolate, localeFromAcceptLanguage, resolveLocale } from './core';
import { MESSAGES, resetLocaleForTests, setLocale, SUPPORTED_LOCALES, t, tFor, tn, tnFor } from './index';

describe('dicionários', () => {
  it('todos os idiomas têm exatamente as mesmas chaves que o en', () => {
    const en = Object.keys(MESSAGES.en).sort();
    for (const l of SUPPORTED_LOCALES) {
      const keys = Object.keys(MESSAGES[l]).sort();
      const missing = en.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !en.includes(k));
      expect({ locale: l, missing, extra }).toEqual({ locale: l, missing: [], extra: [] });
    }
  });

  it('nenhuma mensagem fica vazia', () => {
    for (const l of SUPPORTED_LOCALES) {
      for (const [k, v] of Object.entries(MESSAGES[l])) expect(v, `${l}:${k}`).not.toBe('');
    }
  });

  it('chaves com plural têm .one e .other nos dois idiomas', () => {
    for (const l of SUPPORTED_LOCALES) {
      for (const k of Object.keys(MESSAGES[l])) {
        if (k.endsWith('.other')) expect(MESSAGES[l][k.replace(/\.other$/, '.one')], `${l}:${k}`).toBeTypeOf('string');
        if (k.endsWith('.one')) expect(MESSAGES[l][k.replace(/\.one$/, '.other')], `${l}:${k}`).toBeTypeOf('string');
      }
    }
  });

  it('defineMessages prefixa as chaves pela área', () => {
    const m = defineMessages('x', { a: 'A', 'b.c': 'B' }, { a: 'Á', 'b.c': 'Bê' });
    expect(m.en).toEqual({ 'x.a': 'A', 'x.b.c': 'B' });
    expect(m['pt-BR']['x.b.c']).toBe('Bê');
  });
});

describe('t / interpolação / plural', () => {
  it('interpola {param} e deixa o que não conhece', () => {
    expect(interpolate('Olá, {name}! {x}', { name: 'Ana' })).toBe('Olá, Ana! {x}');
    expect(interpolate('sem params')).toBe('sem params');
  });

  it('tFor cai para en e depois para a chave', () => {
    expect(tFor('pt-BR', 'common.cancel')).toBe('Cancelar');
    expect(tFor('en', 'common.cancel')).toBe('Cancel');
    expect(tFor('pt-BR', 'nope.nope' as never)).toBe('nope.nope');
  });

  it('t segue o idioma atual e tn escolhe one/other', () => {
    resetLocaleForTests('en');
    expect(t('common.ago.minutes', { n: 3 })).toBe('3 min ago');
    setLocale('pt-BR');
    expect(t('common.ago.minutes', { n: 3 })).toBe('há 3 min');
    expect(tn('common.people', 1)).toBe('1 pessoa');
    expect(tn('common.people', 5)).toBe('5 pessoas');
    expect(tnFor('en', 'common.people', 1)).toBe('1 person');
    expect(tnFor('en', 'common.people', 0)).toBe('0 people');
    resetLocaleForTests();
  });
});

describe('resolução de idioma', () => {
  it('casa exato, por idioma base e cai no fallback', () => {
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR');
    expect(resolveLocale(['PT-br'])).toBe('pt-BR');
    expect(resolveLocale(['en-GB', 'pt-BR'])).toBe('en');
    expect(resolveLocale(['de', 'fr'])).toBe('en');
    expect(resolveLocale(['de'], 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale([null, undefined, ''])).toBe('en');
  });

  it('Accept-Language respeita o peso q', () => {
    expect(localeFromAcceptLanguage('pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt-BR');
    expect(localeFromAcceptLanguage('en;q=0.5, pt;q=0.9')).toBe('pt-BR');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE', 'pt-BR')).toBe('pt-BR');
    expect(localeFromAcceptLanguage(undefined, 'pt-BR')).toBe('pt-BR');
    expect(localeFromAcceptLanguage('*')).toBe('en');
  });
});
