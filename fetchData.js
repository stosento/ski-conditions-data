require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { Octokit } = require("@octokit/rest");

// Verify required environment variables
const requiredEnvVars = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"];
const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName],
);

if (missingEnvVars.length > 0) {
  console.error(
    "Missing required environment variables:",
    missingEnvVars.join(", "),
  );
  process.exit(1);
}

// Location coordinates for NWS API
const LOCATIONS = {
  shelbyTownship: {
    lat: 42.6711,
    lon: -83.0328,
    name: "Shelby Township",
  },
  nubsNob: {
    lat: 45.47,
    lon: -84.903,
    name: "Nubs Nob",
  },
  otsegoResort: {
    lat: 45.032644409325755,
    lon: -84.65170507777471,
    name: "Otsego Resort",
  },
};

const dns = require("dns").promises;

// Utility function for checking DNS resolution
async function checkDns(hostname) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch (error) {
    console.error(`DNS lookup failed for ${hostname}:`, error.message);
    return false;
  }
}

// Utility function for retrying failed requests
async function fetchWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      console.log(`Retry ${i + 1}/${retries}`);
    }
  }
}

async function getWeatherData() {
  // Check if weather.gov is accessible
  if (!(await checkDns("api.weather.gov"))) {
    console.error(
      "Cannot resolve api.weather.gov - check your internet connection",
    );
    return {};
  }

  const weatherData = {};

  for (const [locationKey, location] of Object.entries(LOCATIONS)) {
    try {
      console.log(`Fetching weather for ${location.name}...`);

      // First, verify the point
      const pointResponse = await fetchWithRetry(() =>
        axios.get(
          `https://api.weather.gov/points/${location.lat},${location.lon}`,
          {
            headers: {
              "User-Agent": "(ski-conditions-app, stephen.osentoski@gmail.com)",
            },
          },
        ),
      );

      const forecastUrl = pointResponse.data.properties.forecast;
      const hourlyForecastUrl = forecastUrl.replace(
        "/forecast",
        "/forecast/hourly",
      );

      console.log(
        `Fetching forecasts from: ${forecastUrl} and ${hourlyForecastUrl}`,
      );

      // Get both regular forecast and hourly forecast for snow accumulation
      const [forecastResponse, hourlyResponse] = await Promise.all([
        fetchWithRetry(() =>
          axios.get(forecastUrl, {
            headers: {
              "User-Agent": "(ski-conditions-app, stephen.osentoski@gmail.com)",
            },
          }),
        ),
        fetchWithRetry(() =>
          axios.get(hourlyForecastUrl, {
            headers: {
              "User-Agent": "(ski-conditions-app, stephen.osentoski@gmail.com)",
            },
          }),
        ),
      ]);

			// Process the regular forecast periods
			const processedForecasts = forecastResponse.data.properties.periods
				.slice(0, 20)
				.map((period) => {
					// Get the time range for this period
					const startTime = new Date(period.startTime);

					const snowString = "New snow accumulation";
					// Check if the detailedForecast includes snowString. If so, take the final sentence from the detailedForecast and store it within snowAmount
					let snowAccumulation = "";

					// If detailed forecast mentions snow accumulation, extract that information
					if (period.detailedForecast.includes(snowString)) {
						const sentences = period.detailedForecast.split(".");
						const snowSentence = sentences.find((s) => s.includes(snowString));
						if (snowSentence) {
							snowAccumulation = snowSentence.trim();
						}
					}

					// Return the processed forecast data
					return {
						name: period.name,
						timestamp: startTime.getTime(),
						temp: period.temperature,
						snowfall: period.probabilityOfPrecipitation.value || 0,
						snowAmount: snowAccumulation,
						shortForecast: period.shortForecast,
						detailedForecast: period.detailedForecast,
					};
				});

      weatherData[locationKey] = {
        name: location.name,
        forecast: processedForecasts,
      };
    } catch (error) {
      console.error(
        `Error fetching weather for ${location.name}:`,
        error.message,
      );
      if (error.response) {
        console.error("Error response:", error.response.data);
      }

      // Add placeholder data for this location
      weatherData[locationKey] = {
        name: location.name,
        forecast: [
          {
            name: "Unavailable",
            timestamp: new Date().getTime(),
            temp: null,
            snowfall: null,
            snowAmount: "0.0",
            shortForecast: "Weather data temporarily unavailable",
          },
        ],
      };
    }
  }

  return weatherData;
}

async function getMetroparkConditions() {
  const baseUrl = "https://www.metroparks.com/park-closures/";

  const conditions = {};

  try {
    const response = await fetchWithRetry(() =>
      axios.get(baseUrl, {
        headers: {
          "User-Agent": "(ski-conditions-app, stephen.osentoski@gmail.com)",
        },
      }),
    );

    const $ = cheerio.load(response.data);

    // HURON MEADOWS
    const huronPanel = $(`.vc_tta-panel[id="HuronMeadowsMetropark"]`);
    if (huronPanel.length) {
      conditions.HuronMeadowsMetropark = {
        title: huronPanel.find(".vc_tta-title-text").text().trim(),
        sections: [],
      };

      // Find the "Cross Country Ski Trail Conditions" paragraph
      huronPanel.find("p").each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes("Cross Country Ski Trail Conditions")) {
          conditions.HuronMeadowsMetropark.sections.push({
            header: "Cross Country Ski Trail Conditions",
            content: text,
          });
        }
      });

      // Get the bullet list items that follow
      huronPanel.find("ul li").each((_, el) => {
        const liText = $(el).text().trim();
        const strongText = $(el).find("strong").first().text().trim();

        if (strongText) {
          conditions.HuronMeadowsMetropark.sections.push({
            header: strongText,
            content: liText.substring(strongText.length).trim(),
          });
        }
      });
    }

    // STONY CREEK
    const stonyPanel = $(`.vc_tta-panel[id="StonyCreekMetropark"]`);
    if (stonyPanel.length) {
      conditions.StonyCreekMetropark = {
        title: stonyPanel.find(".vc_tta-title-text").text().trim(),
        sections: [],
      };

      // Find paragraphs with ski information
      stonyPanel.find("p").each((_, el) => {
        const strongText = $(el).find("strong").first().text().trim();
        const fullText = $(el).text().trim();

        if (strongText.toLowerCase().includes("ski")) {
          conditions.StonyCreekMetropark.sections.push({
            header: strongText,
            content: fullText.substring(strongText.length).trim(),
          });
        }
      });
    }
  } catch (error) {
    console.error("Error fetching metropark conditions:", error);
    return {
      error: `Failed to fetch conditions: ${error.message}`,
    };
  }

  console.log("Parsed Metropark conditions:", JSON.stringify(conditions, null, 2));
  return conditions;
}

async function getNordicSkiRacerConditions() {
  // Define regions to fetch
  const regions = [11, 13];
  const relevantLocations = [
    "Nubs Nob",
    "Huron Meadows Metropark",
    "Shelby Township",
  ];
  const conditions = {};

  // Fetch data from each region
  await Promise.all(
    regions.map(async (region) => {
      try {
        const response = await fetchWithRetry(() =>
          axios.get(
            `https://nordicskiracer.com/ski-trail-conditions.asp?Region=${region}`,
          ),
        );
        const $ = cheerio.load(response.data);

        // Find all h4 elements
        $("h4").each((i, header) => {
          const headerText = $(header).text().trim();
          // Split on colon and look for location after it
          const parts = headerText.split(":");
          if (parts.length < 2) return;

          const dateSection = parts[0].trim();
          const locationSection = parts[1].trim();

          const relevantLocation = relevantLocations.find((location) =>
            locationSection.toLowerCase().includes(location.toLowerCase()),
          );

          // Only add if location is relevant and we haven't seen it before
          // or if the current report is newer than what we have
          if (relevantLocation) {
            const reportText = $(header).nextAll("p").first().text().trim();
            const currentDate = parseDateFromHeader(dateSection);

            if (
              !conditions[locationSection] ||
              (currentDate &&
                conditions[locationSection].date &&
                currentDate > conditions[locationSection].date)
            ) {
              conditions[locationSection] = {
                lastUpdated: dateSection,
                conditions: reportText,
                date: currentDate, // Store for comparison but don't return
              };
            }
          }
        });
      } catch (error) {
        console.error(`Error fetching region ${region}:`, error);
      }
    }),
  );

  // Remove the date property used for comparison
  Object.values(conditions).forEach((condition) => {
    delete condition.date;
  });

  console.log("Parsed Nordic conditions:", conditions);
  return conditions;
}

// Helper function to parse dates from the header text
function parseDateFromHeader(dateText) {
  try {
    // Example format: "Tue, Jan 14"
    const parts = dateText.split(", ");
    if (parts.length !== 2) return null;

    const datePart = parts[1]; // "Jan 14"
    const currentYear = new Date().getFullYear();
    return new Date(`${datePart}, ${currentYear}`);
  } catch (error) {
    console.error("Error parsing date:", dateText);
    return null;
  }
}

async function getNubsNobConditions() {
  const response = await fetchWithRetry(() =>
    axios.get("https://www.nubsnob.com/conditions-tables/"),
  );
  const $ = cheerio.load(response.data);

  // Helper function to find value for a given label
  const getValueByLabel = (label) => {
    const value = $(".glm-conditions-record.flex")
      .filter((_, el) => {
        const cells = $(el).find(".conditions-cell");
        const firstCell = $(cells[0]).text().trim();
        return firstCell === label;
      })
      .find(".conditions-cell")
      .eq(1) // Get the second cell
      .text()
      .trim();
    return value || "";
  };

  // Helper function for snow data which has multiple cells
  const getSnowData = () => {
    const snowRecord = $(".glm-conditions-record.flex").filter((_, el) => {
      const cells = $(el).find(".conditions-cell");
      const firstCell = $(cells[0]).text().trim();
      return firstCell === "New Snow since yesterday:";
    });

    if (snowRecord.length) {
      const cells = snowRecord.find(".conditions-cell");
      return {
        daily: $(cells[1]).text().trim(),
        threeDays: $(cells[2]).text().trim(),
        sevenDays: $(cells[3]).text().trim(),
        ytd: $(cells[4]).text().trim(),
      };
    }
    return {
      daily: "",
      threeDays: "",
      sevenDays: "",
      ytd: "",
    };
  };

  const conditions = {
    date: getValueByLabel("Date:"),
    liftsOpen: getValueByLabel("Lifts Open:"),
    xcTrails: getValueByLabel("XC Trail System:"),
    nightSkiing: getValueByLabel("Night Skiing:"),
    comments: getValueByLabel("Comments:"),
    snowData: getSnowData(),
  };

  return conditions;
}

async function updateGitHubData(data) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const path = "data/conditions.json";

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
    console.log("File does not exist yet, will create it");
  }

  // Update or create the file
  await octokit.repos.createOrUpdateFileContents({
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    path: path,
    message: "Update conditions data",
    content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
    sha: sha,
  });
}

async function notifyError(error) {
  if (process.env.DISCORD_WEBHOOK) {
    try {
      await axios.post(process.env.DISCORD_WEBHOOK, {
        content: `Error updating ski conditions: ${error.message}\n\`\`\`${error.stack}\`\`\``,
      });
    } catch (notifyError) {
      console.error("Failed to send error notification:", notifyError);
    }
  }
}

async function main() {
  try {
    console.log("Starting data fetch:", new Date().toLocaleString());

    const data = {
      timestamp: new Date().toISOString(),
      weather: await getWeatherData(),
      metroparkConditions: await getMetroparkConditions(),
      nordicConditions: await getNordicSkiRacerConditions(),
      nubsNob: await getNubsNobConditions(),
    };

    await updateGitHubData(data);
    console.log("Data updated successfully");
  } catch (error) {
    console.error("Error updating data:", error);
    await notifyError(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
