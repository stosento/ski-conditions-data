// fetchData.js
const axios = require('axios');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');

// Location coordinates for NWS API
const LOCATIONS = {
    shelbyTownship: {
        gridId: 'DTX',
        gridX: 65,
        gridY: 49,
        name: 'Shelby Township'
    },
    harborSprings: {
        gridId: 'APX',
        gridX: 108,
        gridY: 77,
        name: 'Harbor Springs'
    }
};

// Utility function for retrying failed requests
async function fetchWithRetry(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
            console.log(`Retry ${i + 1}/${retries}`);
        }
    }
}

async function getWeatherData() {
    const weatherData = {};

    for (const [locationKey, location] of Object.entries(LOCATIONS)) {
        const response = await fetchWithRetry(() =>
            axios.get(
                `https://api.weather.gov/gridpoints/${location.gridId}/${location.gridX},${location.gridY}/forecast`,
                {
                    headers: {
                        'User-Agent': '(ski-conditions-app, your-email@example.com)'
                    }
                }
            )
        );

        weatherData[locationKey] = {
            name: location.name,
            forecast: response.data.properties.periods
                .slice(0, 4)
                .map(period => ({
                    name: period.name,
                    timestamp: new Date(period.startTime).getTime(),
                    temp: period.temperature,
                    snowfall: period.probabilityOfPrecipitation.value || 0,
                    shortForecast: period.shortForecast
                }))
        };
    }

    return weatherData;
}

async function getNordicSkiRacerConditions() {
    const response = await fetchWithRetry(() =>
        axios.get('https://nordicskiracer.com/ski-trail-conditions.asp?Region=13')
    );
    const $ = cheerio.load(response.data);

    const relevantLocations = ['Nubs Nob', 'Huron Meadows Metropark'];
    const conditions = {};

    $('table tr').each((i, row) => {
        const location = $(row).find('td:first-child').text().trim();
        if (relevantLocations.includes(location)) {
            conditions[location] = {
                lastUpdated: $(row).find('td:nth-child(2)').text().trim(),
                conditions: $(row).find('td:nth-child(3)').text().trim()
            };
        }
    });

    return conditions;
}

async function getNubsNobConditions() {
    const response = await fetchWithRetry(() =>
        axios.get('https://www.nubsnob.com/conditions-tables/')
    );
    const $ = cheerio.load(response.data);

    const conditions = {
        snowfall24h: $('.conditions-snow24').text().trim(),
        baseDepth: $('.conditions-base').text().trim(),
        openRuns: $('.conditions-runs-open').text().trim(),
        surfaceConditions: $('.conditions-surface').text().trim()
    };

    return conditions;
}

async function updateGitHubData(data) {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const path = 'data/conditions.json';

    // Get the current file's SHA (needed for update)
    let sha;
    try {
        const { data: fileData } = await octokit.repos.getContent({
            owner: process.env.GITHUB_OWNER,
            repo: process.env.GITHUB_REPO,
            path: path,
        });
        sha = fileData.sha;
    } catch (error) {
        // File doesn't exist yet, that's OK
        console.log('File does not exist yet, will create it');
    }

    // Update or create the file
    await octokit.repos.createOrUpdateFileContents({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: path,
        message: 'Update conditions data',
        content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
        sha: sha
    });
}

async function notifyError(error) {
    if (process.env.DISCORD_WEBHOOK) {
        try {
            await axios.post(process.env.DISCORD_WEBHOOK, {
                content: `Error updating ski conditions: ${error.message}\n\`\`\`${error.stack}\`\`\``
            });
        } catch (notifyError) {
            console.error('Failed to send error notification:', notifyError);
        }
    }
}

async function main() {
    try {
        console.log('Starting data fetch:', new Date().toLocaleString());

        const data = {
            timestamp: new Date().toISOString(),
            weather: await getWeatherData(),
            nordicConditions: await getNordicSkiRacerConditions(),
            nubsNob: await getNubsNobConditions()
        };

        await updateGitHubData(data);
        console.log('Data updated successfully');

    } catch (error) {
        console.error('Error updating data:', error);
        await notifyError(error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}
