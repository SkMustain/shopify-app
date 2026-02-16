import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ NO API KEY FOUND IN .env");
    process.exit(1);
}

console.log(`🔑 Testing API Key: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);

const genAI = new GoogleGenerativeAI(apiKey);

async function testModel(modelName) {
    console.log(`\n🤖 Testing Model: ${modelName}...`);
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, are you working?");
        const response = result.response;
        console.log(`✅ SUCCESS [${modelName}]:`, response.text());
        return true;
    } catch (error) {
        console.error(`❌ FAILED [${modelName}]:`, error.message);
        if (error.response) {
            console.error("   Details:", error.response);
        }
        return false;
    }
}

async function run() {
    console.log("--- STANDARD MODELS ---");
    const flashWorking = await testModel("gemini-1.5-flash");
    const proWorking = await testModel("gemini-1.5-pro");
    const v2Working = await testModel("gemini-2.0-flash");

    console.log("\n--- USER REQUESTED (Experimental/Future) ---");
    const v25Flash = await testModel("gemini-2.5-flash");
    const v25Pro = await testModel("gemini-2.5-pro");

    if (!flashWorking && !proWorking && !v2Working) {
        console.error("\n❌ CRITICAL: Even standard models failed. The API Key is 100% invalid or billing is disabled.");
    } else {
        console.log("\n✨ At least one model is working!");
    }
}

run();
