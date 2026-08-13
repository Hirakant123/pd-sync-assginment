import dotenv from "dotenv";
import type { PipedrivePerson } from "./types/pipedrive";
import inputData from "./mappings/inputData.json";
import mappings from "./mappings/mappings.json";

// Load environment variables from .env file
dotenv.config();

// Get API key and company domain from environment variables
const apiKey = process.env.PIPEDRIVE_API_KEY;
const companyDomain = process.env.PIPEDRIVE_COMPANY_DOMAIN;
const baseUrl = `https://${companyDomain}.pipedrive.com/api/v1`;

// Helper to get a value from inputData, even if the key is nested
// e.g. phone.home -> inputData.phone.home
function getValue(obj: any, path: string) {
  const keys = path.split(".");
  let value = obj;
  for (const key of keys) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

const syncPdPerson = async (): Promise<PipedrivePerson> => {
  try {
    // Edge case 1: make sure API key and domain are set
    if (!apiKey || !companyDomain) {
      throw new Error("PIPEDRIVE_API_KEY or PIPEDRIVE_COMPANY_DOMAIN missing in .env");
    }

    // Build the payload for Pipedrive using mappings.json
    const payload: Record<string, any> = {};

    for (const map of mappings) {
      const value = getValue(inputData, map.inputKey);

      // Edge case 2: if the inputKey doesn't exist in inputData, skip it
      // instead of sending "undefined" to the API
      if (value === undefined) {
        console.log(`Skipping ${map.inputKey} -> ${map.pipedriveKey}, not found in inputData.json`);
        continue;
      }

      payload[map.pipedriveKey] = value;
    }

    // Get the name value (used to search for existing person)
    const name = payload["name"];

    // Edge case 3: if there is no name, we cannot search/create the person
    if (!name) {
      throw new Error("No name value found, cannot search or create person");
    }

    // Step 1: check if the person already exists by name
    // I first tried using the /persons/search API, but it had a problem.
    // Sometimes after creating a new person, searching for them right away
    // would not find them (maybe because the search takes a little time
    // to update). This caused the code to create duplicate persons.
    // So instead, I am getting the full list of persons and checking
    // the name manually. This works correctly every time.
    
    const listRes = await fetch(`${baseUrl}/persons?api_token=${apiKey}`);
    const listData = await listRes.json();

    if (!listRes.ok) {
      throw new Error(`Fetching persons list failed: ${listData.error || listRes.statusText}`);
    }

    const allPersons = listData.data || [];
    const existingPerson = allPersons.find(
      (p: any) => p.name?.toLowerCase() === name.toLowerCase()
    );

    let response;

    if (existingPerson) {
      // Person found now update
      console.log(`Person "${name}" found (id: ${existingPerson.id}). Updating...`);
      response = await fetch(`${baseUrl}/persons/${existingPerson.id}?api_token=${apiKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      // Person not found now we can create
      console.log(`Person "${name}" not found. Creating new person...`);
      response = await fetch(`${baseUrl}/persons?api_token=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(`Pipedrive API error: ${result.error || response.statusText}`);
    }

    return result.data as PipedrivePerson;
  } catch (error: any) {
    console.error("syncPdPerson failed:", error.message);
    throw error;
  }
};

syncPdPerson()
  .then((person) => console.log(person))
  .catch(() => process.exit(1));