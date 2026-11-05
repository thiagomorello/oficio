{{/*
Chart name.
*/}}
{{- define "oficio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name (release + chart, or fullnameOverride).
*/}}
{{- define "oficio.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "oficio.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels (without component).
*/}}
{{- define "oficio.labels" -}}
helm.sh/chart: {{ include "oficio.chart" . }}
app.kubernetes.io/name: {{ include "oficio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: oficio
{{- end }}

{{/*
Selector labels for a component. Usage: include "oficio.selectorLabels" (dict "ctx" $ "component" "app")
*/}}
{{- define "oficio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "oficio.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Resource names per component.
*/}}
{{- define "oficio.mysql.fullname" -}}
{{- printf "%s-mysql" (include "oficio.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "oficio.livekit.fullname" -}}
{{- printf "%s-livekit" (include "oficio.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "oficio.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "oficio.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "oficio.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/*
Name of the Secret the app mounts with envFrom.
*/}}
{{- define "oficio.secretName" -}}
{{- default (include "oficio.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/*
Name of the Secret holding the bundled MySQL passwords (keys mysql-password / mysql-root-password).
*/}}
{{- define "oficio.mysql.secretName" -}}
{{- default (include "oficio.mysql.fullname" .) .Values.mysql.auth.existingSecret }}
{{- end }}

{{/*
A secret value that survives upgrades: explicit value from values.yaml, else the value already stored in the live
Secret (lookup; empty under `helm template`), else the generated default passed by the caller.
Usage: include "oficio.keepSecret" (dict "ctx" $ "secret" "<name>" "key" "<KEY>" "value" .Values.x "default" (randAlphaNum 32))
*/}}
{{- define "oficio.keepSecret" -}}
{{- if .value -}}
{{- .value -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace .secret -}}
{{- if and $existing (hasKey (default dict $existing.data) .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- .default -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Public URL of the office (OFFICE_PUBLIC_URL).
*/}}
{{- define "oficio.publicUrl" -}}
{{- if .Values.office.publicUrl -}}
{{- .Values.office.publicUrl -}}
{{- else if and .Values.ingress.enabled .Values.ingress.host -}}
{{- printf "https://%s" .Values.ingress.host -}}
{{- end -}}
{{- end }}

{{/*
OFFICE_ALLOWED_HOSTS: explicit value, else the Ingress host. Rendering fails when both are empty, because without
it every request from a real host name is answered with 403.
*/}}
{{- define "oficio.allowedHosts" -}}
{{- $hosts := .Values.office.allowedHosts -}}
{{- if and (not $hosts) .Values.ingress.enabled -}}
{{- $hosts = .Values.ingress.host -}}
{{- end -}}
{{- required "Set office.allowedHosts (or ingress.enabled=true with ingress.host): the host names browsers will use to reach the office." $hosts -}}
{{- end }}

{{/*
LIVEKIT_URL: the public wss:// URL browsers connect to.
Bundled LiveKit: livekit.publicUrl, else wss://<livekit.ingress.host>. External: livekit.external.url.
Empty is allowed only for the external mode (the office then runs without audio/video).
*/}}
{{- define "oficio.livekit.publicUrl" -}}
{{- if .Values.livekit.enabled -}}
{{- $url := .Values.livekit.publicUrl -}}
{{- if and (not $url) .Values.livekit.ingress.enabled .Values.livekit.ingress.host -}}
{{- $url = printf "wss://%s" .Values.livekit.ingress.host -}}
{{- end -}}
{{- required "Set livekit.publicUrl (wss://livekit.example.com) or enable livekit.ingress with a host: browsers need a TLS URL to reach the bundled LiveKit." $url -}}
{{- else -}}
{{- .Values.livekit.external.url -}}
{{- end -}}
{{- end }}

{{/*
LIVEKIT_INTERNAL_URL: what the app uses for the LiveKit room-service API.
Bundled: the ClusterIP Service on 7880. External: livekit.external.internalUrl, else the public URL.
*/}}
{{- define "oficio.livekit.internalUrl" -}}
{{- if .Values.livekit.enabled -}}
{{- printf "http://%s:7880" (include "oficio.livekit.fullname" .) -}}
{{- else -}}
{{- default .Values.livekit.external.url .Values.livekit.external.internalUrl -}}
{{- end -}}
{{- end }}

{{/*
Whether the external MySQL is given as a full URL (DATABASE_URL) rather than parts.
*/}}
{{- define "oficio.mysql.externalUrlMode" -}}
{{- if and (not .Values.mysql.enabled) .Values.mysql.external.databaseUrl -}}true{{- end -}}
{{- end }}

{{/*
Name of the ConfigMap holding the CA bundle for the external MySQL (key ca.crt), or empty when no CA is configured.
*/}}
{{- define "oficio.mysql.caConfigMap" -}}
{{- if not .Values.mysql.enabled -}}
{{- if .Values.mysql.external.sslCaConfigMap -}}
{{- .Values.mysql.external.sslCaConfigMap -}}
{{- else if .Values.mysql.external.sslCa -}}
{{- printf "%s-mysql-ca" (include "oficio.fullname" .) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Ingress annotations shared by the app and the LiveKit Ingress (WebSocket presets + cert-manager).
Usage: include "oficio.ingressAnnotations" (dict "ctx" $ "extra" .Values.ingress.annotations)
*/}}
{{- define "oficio.ingressAnnotations" -}}
{{- $ing := .ctx.Values.ingress -}}
{{- $ann := dict -}}
{{- if $ing.nginx.enabled -}}
{{- $_ := set $ann "nginx.ingress.kubernetes.io/proxy-read-timeout" ($ing.nginx.proxyReadTimeout | toString) -}}
{{- $_ := set $ann "nginx.ingress.kubernetes.io/proxy-send-timeout" ($ing.nginx.proxySendTimeout | toString) -}}
{{- $_ := set $ann "nginx.ingress.kubernetes.io/proxy-body-size" ($ing.nginx.proxyBodySize | toString) -}}
{{- end -}}
{{- if $ing.traefik.enabled -}}
{{- $_ := set $ann "traefik.ingress.kubernetes.io/router.entrypoints" ($ing.traefik.entrypoints | toString) -}}
{{- $_ := set $ann "traefik.ingress.kubernetes.io/router.tls" "true" -}}
{{- end -}}
{{- if $ing.certManager.clusterIssuer -}}
{{- $_ := set $ann "cert-manager.io/cluster-issuer" $ing.certManager.clusterIssuer -}}
{{- else if $ing.certManager.issuer -}}
{{- $_ := set $ann "cert-manager.io/issuer" $ing.certManager.issuer -}}
{{- end -}}
{{- $ann = mustMergeOverwrite $ann (default dict .extra) -}}
{{- toYaml $ann -}}
{{- end }}
