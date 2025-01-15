# Ski Conditions Data Fetcher

## The Problem

Whenever I had a desire to go skiing, there were several checks in order to determine the conditions, weather, etc. These checks included:

1. Weather — how cold? How much snow is expected in the days leading up to the skiing?
2. Hill Conditions — What's the grooming at the hill like? How many lifts are open?
3. Nordic Trails — Any blog post entries for the locations I XC ski at? Are the trails set?

To answer these questions, this meant visiting multiple websites and filtering through irrelevant information. It would be much quicker if those sites offered an RSS feed, but alas, that's far in the rear view mirror.

## The Solution

This repository is part of a two-repository solution that creates a dashboard compiling data from:

- National Weather Service API
- Nubs Nob website
- Nordic Ski Racer website

This repository (`ski-conditions-data`) handles the data collection and processing, while the companion repository [`ski-conditions-website`](https://github.com/stosento/ski-conditions-website) handles the display.

## Technical Details

This is a Node.js application that scrapes and processes data from multiple sources into a single JSON file. The app runs on a schedule via GitHub Actions and updates a `conditions.json` file that's consumed by the dashboard website.

### Libraries Used

- `axios`: Makes HTTP requests to fetch data from:
    - National Weather Service API
    - Nubs Nob website
    - Nordic Ski Racer website
- `cheerio`: Parses HTML and provides jQuery-like syntax for extracting data from:
    - Nubs Nob conditions page
    - Nordic Ski Racer conditions page
- `@octokit/rest`: Updates the conditions.json file in this repository

### Installation & Local Development

1. Clone the repository
```bash
git clone https://github.com/stosento/ski-conditions-data.git
cd ski-conditions-data
```

2. Install dependencies
```bash
npm install
```

3. Run locally
```bash
node fetchData.js
```

### GitHub Actions Configuration

The data fetcher runs automatically via GitHub Actions. The workflow:
- Runs every 5 hours (8am, 1pm, and 6pm ET)
- Fetches fresh data from all sources
- Updates conditions.json in the repository
- Can be triggered manually via the Actions tab if needed

The workflow configuration can be found in `.github/workflows/update-conditions.yml`.

## Project Structure

```
ski-conditions-data/
├── .github/
│   └── workflows/
│       └── update-conditions.yml
├── fetchData.js        # Main data collection script
├── package.json        # Dependencies and scripts
└── data/
    └── conditions.json # Generated data file
```

## Related Projects

This repository works in conjunction with [`ski-conditions-website`](https://github.com/stosento/ski-conditions-website), which provides the frontend dashboard that displays this data. The website fetches the `conditions.json` file directly from this repository's raw content URL.
