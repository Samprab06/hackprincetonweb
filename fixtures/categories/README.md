# Intake category defaults

These files supply editable starting assumptions for HAC-19. Every value has
`origin: "default"`, a unit and evidence IDs resolving to the file's `sources`.
They are not calibrated demand estimates or promised business outcomes.

## Authored scenario inputs

The following table is the original source for the `hac19-<category>-scenario-v1`
evidence records. These are deliberately authored product scenarios, **not values
reported by an external study**. Review them with the founder before using results.

| Input                                                         | Coffee              | Quick food          | Salon/barber        | Fitness             |
| ------------------------------------------------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| Service minutes/customer                                      | 4                   | 5                   | 30                  | 60                  |
| Travel minutes                                                | 10                  | 10                  | 15                  | 15                  |
| Visits/person/month                                           | 8                   | 4                   | 1                   | 8                   |
| COGS/revenue fraction                                         | 0.30                | 0.32                | 0.10                | 0.05                |
| Square feet/station                                           | 100                 | 120                 | 100                 | 50                  |
| Minimum front-of-house square feet                            | 600                 | 700                 | 400                 | 600                 |
| Patience minutes                                              | 8                   | 10                  | 15                  | 10                  |
| Early morning / morning / midday / afternoon / evening shares | .10/.40/.20/.20/.10 | .05/.10/.40/.20/.25 | .00/.20/.30/.35/.15 | .20/.10/.15/.15/.40 |

Travel and visit rates represent one provisional segment. Peak shares describe a
single illustrative day. Service duration represents station occupancy, so fitness
is a session rather than a checkout transaction. Station area and front-of-house
area are modeling assumptions, not building-code, accessibility or occupancy
requirements. No market calibration, local rent, demand or lease suitability is
implied by these values.

## Wage proxies

Sources were checked on November 14, 2026. Their reference period is May 2025:

- Coffee and quick food use the national median hourly wage of $15.24 for
  [food and beverage serving workers](https://www.bls.gov/ooh/food-preparation-and-serving/food-and-beverage-serving-and-related-workers.htm).
- Salon/barber uses the $17.21 hairdresser/hairstylist/cosmetologist median as a
  provisional mixed-category proxy from
  [BLS personal care occupations](https://www.bls.gov/ooh/personal-care-and-service/barbers-hairstylists-and-cosmetologists.htm).
- Fitness uses the $47,160 national annual median for
  [fitness trainers and instructors](https://www.bls.gov/ooh/personal-care-and-service/fitness-trainers-and-instructors.htm),
  divided by an assumed 2,080 working hours/year and rounded to 2,267 cents/hour.

These proxies are not Houston/Los Angeles quotes or total employer costs. They do
not incorporate payroll taxes, benefits, local wage requirements or founder staffing
mix. Founder overrides must become `origin: "founder"` and reference founder evidence.

Unsupported categories receive no service-category defaults. Missing founder
answers remain explicit missing fields/findings rather than being invented.
