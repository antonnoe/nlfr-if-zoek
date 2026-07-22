# NLFR bereik-test — resultaat

Uitgevoerd door GitHub Actions (ubuntu-latest) op 2026-07-22 06:59:49 UTC.

Doel: kan een Actions-runner nederlanders.fr server-side ophalen?
Per URL: HTTP-statuscode, response-grootte (bytes), herkenbare markers, eerste 300 tekens.

## https://www.nederlanders.fr/main/search/search?q=septic+tank

- HTTP-statuscode: `000`
- Response-grootte: `0` bytes
- curl-exitcode: `60`
- curl-foutmelding: `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Markers (zoekpagina: "toegevoegd door" of /profiles/blogs/): **nee**
- Eerste 300 tekens:

~~~html

~~~

## https://www.nederlanders.fr/profiles/blog/feed?xn_auth=no

- HTTP-statuscode: `000`
- Response-grootte: `0` bytes
- curl-exitcode: `60`
- curl-foutmelding: `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Markers (feed: <rss of <feed): **nee**
- Eerste 300 tekens:

~~~html

~~~

## https://www.nederlanders.fr/profiles/blog/list?promoted=1

- HTTP-statuscode: `000`
- Response-grootte: `0` bytes
- curl-exitcode: `60`
- curl-foutmelding: `curl: (60) SSL certificate problem: unable to get local issuer certificate More details here: https://curl.se/docs/sslcerts.html curl failed to verify the legitimacy of the server and therefore could `
- Markers (promoted-lijst: /profiles/blogs/): **nee**
- Eerste 300 tekens:

~~~html

~~~

