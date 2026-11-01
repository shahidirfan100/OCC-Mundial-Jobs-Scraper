## What does OCC Mundial Jobs Scraper do?

OCC Mundial Jobs Scraper collects job listings and full job descriptions from [OCC Mundial](https://www.occ.com.mx/), a Mexican job board. Paste an OCC search URL, or enter a keyword and location, and the Actor returns clean records with job title, company, salary, location, work mode, contract type, category, posting date, benefits, and the complete description.

Use it to build a Mexico hiring dataset, track new vacancies by city or job area, compare salaries, or feed job data into a spreadsheet, dashboard, or AI workflow. Each run writes directly to an Apify dataset that you can export as JSON, CSV, Excel, or XML.

## Why use OCC Mundial Jobs Scraper?

- Collect vacancies from OCC without manual copy-paste, including state, city, category, and company-board searches.
- Get the complete description, salary range, benefits, education requirement, work mode, and posting date for every job.
- Start from a keyword and location, a search URL, a category page, a company board, or a single job URL.
- The Actor removes empty fields instead of writing null, so your dataset stays readable and easy to load.
- Schedule daily or hourly runs, connect webhooks, or pull the dataset from the Apify API.
- Set how many pages to visit and how many jobs to save; the Actor stops when it reaches either limit.

## What data can you extract from OCC Mundial?

| Field | Description |
|-------|-------------|
| `job_id` | OCC offer identifier |
| `title` | Published job title |
| `company` | Hiring company, or `Empresa confidencial` when the employer is hidden |
| `location` | City and state, or the state when no city is published |
| `city` | City name |
| `state` | State name |
| `salary` | Salary text as displayed by OCC |
| `salary_min` | Lower salary bound in MXN |
| `salary_max` | Upper salary bound in MXN |
| `salary_currency` | Salary currency, MXN |
| `salary_period` | Pay period derived from the salary text |
| `employment_type` | Contract type such as Tiempo completo, Medio tiempo, or Honorarios |
| `work_schedule` | Schedule such as Jornada completa or Tiempo parcial |
| `work_mode` | On-site, Hybrid, or Remote |
| `category` | Top-level job category |
| `subcategory` | Detailed job subcategory |
| `education` | Minimum education requested |
| `date_posted` | Publication date in YYYY-MM-DD format |
| `posted_text` | Relative label such as "Hace 2 días" |
| `expires_at` | Expiration date in YYYY-MM-DD format |
| `benefits` | Benefits published by the employer |
| `keywords` | Keywords attached to the offer |
| `description` | Full description as plain text |
| `description_html` | Full description as published HTML |
| `company_url` | Company board URL on OCC |
| `company_logo` | Company logo URL |
| `is_verified_company` | Whether OCC marks the company as verified |
| `url` | Public job detail URL |
| `source` | Always `occ.com.mx` |
| `scraped_at` | ISO timestamp of the extraction |

## How to use OCC Mundial Jobs Scraper

1. Open the Actor on Apify Store.
2. Enter a keyword and location, or paste an OCC URL in the Start URL field.
3. Set the maximum number of results and the page limit.
4. Keep the recommended proxy configuration.
5. Run the Actor and open the dataset when it finishes.
6. Download the data or connect it to your workflow.

A custom Start URL takes priority over the keyword and location fields. This lets you use OCC's own filters for salary, recency, work model, contract type, or sorting. The default Start URL is the general OCC board; if you keep that default and enter a keyword or location, the Actor uses the keyword and location.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `https://www.occ.com.mx/empleos/` | OCC search, category, company-board, or job-detail URL. A custom URL takes priority over keyword and location. |
| `keyword` | String | No | - | Job title, skill, or search term. Used when the Start URL is the default general board. |
| `location` | String | No | - | Mexican state, city, or neighborhood. Used when the Start URL is the default general board. |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save to the dataset. |
| `max_pages` | Integer | No | `5` | Safety cap on the number of search result pages to visit. Each page holds about 20 jobs. |
| `proxyConfiguration` | Object | No | Apify Residential | Proxy settings. An Apify Residential proxy is recommended for reliable access. |

## Usage Examples

### Search by keyword and location

Collect accountants in Mexico City:

```json
{
  "keyword": "contador",
  "location": "Ciudad de México",
  "results_wanted": 50,
  "max_pages": 3
}
```

### Search a whole state

Collect software jobs across Jalisco:

```json
{
  "keyword": "desarrollador de software",
  "location": "Jalisco",
  "results_wanted": 100,
  "max_pages": 5
}
```

### Start from an OCC search URL

Use a native OCC URL with your own filters:

```json
{
  "url": "https://www.occ.com.mx/empleos/de-contador/en-ciudad-de-mexico/?smin=20000",
  "results_wanted": 100,
  "max_pages": 5
}
```

### Collect a company board

Collect all current vacancies from a company page:

```json
{
  "url": "https://www.occ.com.mx/empleos/bolsa-de-trabajo-Kelly-Services/",
  "results_wanted": 200,
  "max_pages": 10
}
```

### Collect one job

Paste a single OCC job URL to save that job only:

```json
{
  "url": "https://www.occ.com.mx/empleo/oferta/21392757-asesor-o-ejecutivo-comercial-previsional-afore-lunes-a-viernes-home-office",
  "results_wanted": 1
}
```

## Sample Output

This record comes from a real run. The description is shortened for readability.

```json
{
  "job_id": "21386495",
  "title": "Contador jr",
  "company": "Empresa confidencial",
  "is_verified_company": true,
  "location": "Álvaro Obregón, Ciudad de México",
  "city": "Álvaro Obregón",
  "state": "Ciudad de México",
  "salary": "$20,000 Mensual",
  "salary_min": 20000,
  "salary_max": 20000,
  "salary_currency": "MXN",
  "salary_period": "monthly",
  "employment_type": "Tiempo completo",
  "work_schedule": "Jornada completa",
  "work_mode": "On-site",
  "category": "Contabilidad - Finanzas",
  "subcategory": "Contabilidad",
  "education": "Universitario titulado",
  "date_posted": "2026-10-30",
  "posted_text": "Hace 2 días",
  "expires_at": "2026-12-22",
  "benefits": [
    "Fondo de ahorro",
    "Vales de despensa",
    "Seguro de vida"
  ],
  "description": "Contador Jr. Empresa líder en su ramo, en crecimiento, busca integrar a su equipo de Contabilidad un Analista Contable con experiencia sólida en contabilidad general y cierres mensuales.",
  "url": "https://www.occ.com.mx/empleo/oferta/21386495-contador-jr",
  "source": "occ.com.mx",
  "scraped_at": "2026-11-01T10:46:18.091Z"
}
```

## Tips for Best Results

- Enter the location the way OCC lists it, such as `Ciudad de México`, `Nuevo León`, `Jalisco`, or `Monterrey`. The Actor resolves common city names to the correct OCC location page.
- Use a Start URL when you need OCC's salary, recency, work-model, or contract filters. The URL keeps its native filters.
- Start with `results_wanted` set to 20 or 50 while testing. Increase it after you confirm the search returns the jobs you expect.
- `max_pages` is a safety cap, not a target. If you ask for 500 jobs but set `max_pages` to 2, the run stops after about 40 jobs.
- Keep the Apify Residential proxy. OCC protects its search pages. Residential sessions from different countries work; Mexico can add consistency but is not required.
- Salary fields appear only when the employer publishes pay. Many OCC jobs hide the salary, so treat missing salary values as source data, not a scraper error.
- Public job boards change over time. If a field stops appearing, open an issue with the URL and run ID.

## Integrations

- **Google Sheets** - Send each run to a spreadsheet for review or sharing.
- **Webhooks** - Trigger a downstream workflow when a run finishes.
- **Make or Zapier** - Connect job data to no-code automations.
- **Apify API** - Pull dataset items into your own application or data warehouse.
- **Scheduled runs** - Refresh the dataset daily or hourly to track new vacancies.

## Frequently Asked Questions

### Can I export OCC job data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats from the Console or through the API.

### Can I schedule this Actor?

Yes. Create a schedule in Apify Console and choose an hourly, daily, weekly, or custom interval. Scheduled runs are useful for tracking new OCC vacancies.

### Does the Actor work with company career pages on OCC?

Yes. Paste a company board URL such as `https://www.occ.com.mx/empleos/bolsa-de-trabajo-Company-Name/` and the Actor collects that company's current vacancies.

### Why are some salary fields missing?

OCC lets employers hide salary information. When pay is not published, the Actor leaves the salary fields out instead of guessing a number.

### Why does the company say "Empresa confidencial"?

Some employers hide their name on OCC. The Actor uses the same label OCC shows and does not invent a company name.

### How many jobs are on each page?

OCC returns about 20 jobs per search page. Use `max_pages` together with `results_wanted` to control the size of each run.

### Can I collect a single job?

Yes. Paste the public job detail URL in `url` and the Actor saves that job only.

### Does the Actor include the full job description?

Yes. Every record includes the full description as plain text and as HTML when OCC publishes it.

### Is it legal to scrape OCC Mundial?

Scraping public job data can be legal, but you are responsible for complying with applicable laws, OCC's terms, and privacy rules. Use the data responsibly and do not republish personal contact information.

## Related Actors

- [Bumeran Jobs Scraper](https://apify.com/shahidirfan/bumeran-jobs-scraper) - Collect job listings from Bumeran across Latin America.
- [Computrabajo Jobs Scraper](https://apify.com/shahidirfan/Computrabajo-Jobs-Scraper) - Collect job listings from Computrabajo in Mexico and other markets.
- [SimplyHired Job Scraper](https://apify.com/shahidirfan/Simplyhired-Job-Scraper) - Collect job listings from SimplyHired.
- [Fast LinkedIn Job Scraper](https://apify.com/shahidirfan/Fast-LinkedIn-job-Scraper) - Collect public LinkedIn job listings.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate collection of publicly available job data. Users are responsible for using the data responsibly and complying with applicable laws, OCC's terms of service, and privacy rules. OCC does not endorse this Actor.
