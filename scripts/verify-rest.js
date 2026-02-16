const apiKey = "AIzaSyBCPhHkVY-cYGS8EudQtqs2brbFzwBqFBM";
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

async function testRest() {
    console.log("🚀 Testing Gemini 2.0 Flash via REST...");
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Explain how AI works in a few words" }]
                }]
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("✅ SUCCESS:", data?.candidates?.[0]?.content?.parts?.[0]?.text);
            return true;
        } else {
            console.error("❌ FAILED:", JSON.stringify(data, null, 2));
            return false;
        }
    } catch (error) {
        console.error("❌ EXCEPTION:", error.message);
        return false;
    }
}

testRest();
