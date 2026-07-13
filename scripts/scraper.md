# Salesforce Debug Log Events - Scraper Reference

How to fetch raw content from the official Salesforce documentation sources used in `salesforce-debug-log-events.json`.

Both Salesforce doc sites are client-side rendered SPAs — standard HTML fetching only returns JavaScript bootstrap code, not the actual documentation content.

---

## S1: Salesforce Help - Debug Log Levels

- **Display URL**: https://help.salesforce.com/s/articleView?id=platform.code_setting_debug_log_levels.htm&language=en_US&type=5
- **Scrapable URL**: None — not possible to scrape programmatically
- **Status**: Unscrapable. The help.salesforce.com site is a Salesforce Experience Cloud (Aura) app. Article content is loaded via authenticated Aura RPC actions (`ApexActionController/ACTION$execute`). The Aura endpoint requires a valid `fwuid` token and session context, and returns `clientOutOfSync` errors for unauthenticated requests. There is no public raw content API equivalent to `get_document_content`.
- **Workaround**: Content must be obtained manually (copy-paste from browser) or from proxy sources that reference this page (e.g., the [FishOfPrey gist](https://gist.github.com/FishOfPrey/9c6b6d3a6d9e0147143b0c54d615a677) which was compiled from this page).

---

## S2: Salesforce Developer Docs - Debug Log Console

- **Display URL**: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_system_log_console.htm

### Raw Content API

The developer.salesforce.com site has an internal REST endpoint that returns page content without the SPA shell:

```
https://developer.salesforce.com/docs/get_document_content/{doc_set}/{page_id}/{locale}/{doc_version}
```

#### Parameters

| Parameter     | Description                                                                            | Example                                 |
| ------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `doc_set`     | Documentation collection identifier, matches the URL path segment after `atlas.en-us.` | `apexcode`                              |
| `page_id`     | Page filename from the display URL                                                     | `apex_debugging_system_log_console.htm` |
| `locale`      | Language/region code                                                                   | `en-us`                                 |
| `doc_version` | Salesforce platform release version number (see table below)                           | `260.0`                                 |

#### Example

```
https://developer.salesforce.com/docs/get_document_content/apexcode/apex_debugging_system_log_console.htm/en-us/260.0
```

### Doc Version Numbers

The doc version increments by 2 with each Salesforce release (3 releases per year):

| Release                  | API Version | Doc Version |
| ------------------------ | ----------- | ----------- |
| Spring '24               | 60.0        | 248.0       |
| Summer '24               | 61.0        | 250.0       |
| Winter '25               | 62.0        | 252.0       |
| Spring '25               | 63.0        | 254.0       |
| Summer '25               | 64.0        | 256.0       |
| Winter '26               | 65.0        | 258.0       |
| **Spring '26 (current)** | **66.0**    | **260.0**   |

**Formula**: `doc_version = (API_version - 60) × 2 + 248`
(e.g., API 66.0 → (66 - 60) × 2 + 248 = 260)

### Notes

- The response is HTML content (not JSON) — it contains the rendered documentation body.
- No authentication required.
- Content is the same as what the SPA renders; the SPA calls this endpoint internally.
- If a doc version returns an error, try an older version — not all versions are always available.
