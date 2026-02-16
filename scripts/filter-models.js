
import fs from 'fs';

try {
    const data = fs.readFileSync('models.json', 'utf8');
    const json = JSON.parse(data);

    console.log("--- MODELS SUPPORTING generateContent ---");
    if (json.models) {
        json.models.forEach(m => {
            if (m.supportedGenerationMethods.includes("generateContent")) {
                console.log(`Model: ${m.name.replace("models/", "")}`);
                console.log(`Version: ${m.version}`);
                console.log(`DisplayName: ${m.displayName}`);
                console.log("-----------------------------------");
            }
        });
    } else {
        console.log("No models found in JSON. Raw data:", data.substring(0, 100));
    }
} catch (e) {
    console.error("Error parsing JSON:", e.message);
}
