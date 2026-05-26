import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function verifyDBKey() {
    console.log("--- Diagnosing Saved Gemini API Key ---");

    try {
        const settings = await prisma.appSetting.findMany();
        console.log("Total settings in database:", settings.length);
        settings.forEach(s => {
            console.log(`- Key: "${s.key}" | Value Length: ${s.value ? s.value.length : 0} | Masked Value: ${s.value ? s.value.slice(0, 5) + "..." + s.value.slice(-5) : "N/A"}`);
        });

        const apiKeyObj = await prisma.appSetting.findUnique({
            where: { key: "GEMINI_API_KEY" }
        });

        if (apiKeyObj && apiKeyObj.value) {
            console.log("✅ SUCCESS! GEMINI_API_KEY is found in the database.");
        } else {
            console.error("❌ ERROR: GEMINI_API_KEY is NOT found in the database settings table!");
            console.log("This is why the agent is running in Resilient Safe Fallback Mode!");
        }

    } catch (e) {
        console.error("❌ ERROR reading database settings:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

verifyDBKey();
