# NLFR bereik-test — resultaat

Uitgevoerd door GitHub Actions (ubuntu-latest) op 2026-07-22 07:32:25 UTC.

Doel: kan een Actions-runner nederlanders.fr server-side ophalen?
Per URL: HTTP-statuscode, response-grootte (bytes), herkenbare markers, eerste 300 tekens.

## https://www.nederlanders.fr/main/search/search?q=septic+tank

- HTTP-statuscode (beveiligd): `000`
- Response-grootte (beveiligd): `0` bytes
- curl-exitcode (beveiligd): `60`
- curl-foutmelding (beveiligd): `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Insecure fallback-probe (`curl -k`, alleen diagnose):
  - HTTP-statuscode: `200`
  - Response-grootte: `48616` bytes
  - curl-exitcode: `0`
- Markers (zoekpagina: "toegevoegd door" of /profiles/blogs/): **ja (toegevoegd door)**
- Eerste 300 tekens (uit fallback-probe):

~~~html
 <!DOCTYPE html> <html lang="nl" xmlns:og="http://ogp.me/ns#">     <head data-layout-view="default"> <script>     window.dataLayer = window.dataLayer || [];         </script> <!-- Google Tag Manager --> <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(),event:'gt
~~~

## https://www.nederlanders.fr/profiles/blog/feed?xn_auth=no

- HTTP-statuscode (beveiligd): `000`
- Response-grootte (beveiligd): `0` bytes
- curl-exitcode (beveiligd): `60`
- curl-foutmelding (beveiligd): `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Insecure fallback-probe (`curl -k`, alleen diagnose):
  - HTTP-statuscode: `200`
  - Response-grootte: `174203` bytes
  - curl-exitcode: `0`
- Markers (feed: <rss of <feed): **ja (<feed)**
- Eerste 300 tekens (uit fallback-probe):

~~~html
<?xml version="1.0" encoding="utf-8"?>         <feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">             <title>Alle berichten - Nederlanders.fr</title>             <link rel="self" href="https://www.nederlanders.fr/profiles/blog/feed?xn_auth=no"/>           
~~~

## https://www.nederlanders.fr/profiles/blog/list?promoted=1

- HTTP-statuscode (beveiligd): `000`
- Response-grootte (beveiligd): `0` bytes
- curl-exitcode (beveiligd): `60`
- curl-foutmelding (beveiligd): `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Insecure fallback-probe (`curl -k`, alleen diagnose):
  - HTTP-statuscode: `200`
  - Response-grootte: `103941` bytes
  - curl-exitcode: `0`
- Markers (promoted-lijst: /profiles/blogs/): **ja (/profiles/blogs/)**
- Eerste 300 tekens (uit fallback-probe):

~~~html
<!DOCTYPE html> <html lang="nl" xmlns:og="http://ogp.me/ns#">     <head data-layout-view="default"> <script>     window.dataLayer = window.dataLayer || [];         </script> <!-- Google Tag Manager --> <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(),event:'gtm
~~~

---

## Certketen aanvullen (fix voor curl error 60)

- Certificaten die de server aanbiedt: **2**
- Issuer van het leaf-certificaat: `C = US, O = Let's Encrypt, CN = YR2`
- AIA CA-Issuers-URL: `http://yr2.i.lencr.org/`
- Intermediate opgehaald: **ja (DER)**
- Intermediate: `C = US, O = Let's Encrypt, CN = YR2`
- Root gevonden in systeem-truststore: **nee**
- Bundle geschreven naar `certs/ning-ca-bundle.pem` (1 certificaten)
- Verificatie `curl --cacert certs/ning-ca-bundle.pem https://www.nederlanders.fr/` (zonder `-k`): HTTP **`200`**
  - ✅ De aangevulde keten werkt: NING is nu bereikbaar met normale TLS-verificatie.

