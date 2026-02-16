
const apiKey = "AIzaSyAtP79orpxHEbMLd8Ux-2W3rdLnOGgO-hY";
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function listModels() {
    console.log("Fetching available models via REST API...");
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("API Error:", data.error);
            return;
        }

        if (data.models) {
            console.log("\n--- AVAILABLE MODELS ---");
            data.models.forEach(m => {
                if (m.supportedGenerationMethods.includes("generateContent")) {
                    console.log(`✅ ${m.name.replace("models/", "")} (${m.version})`);
                }
            });
        } else {
            console.log("No models found in response:", data);
        }
    } catch (error) {
        console.error("Fetch Error:", error.message);
    }
}

listModels();
