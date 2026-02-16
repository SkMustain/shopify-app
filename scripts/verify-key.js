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
    const flashWorking = await testModel("gemini-1.5-flash");
    const proWorking = await testModel("gemini-1.5-pro");
    const v2Working = await testModel("gemini-2.0-flash");

    if (!flashWorking && !proWorking && !v2Working) {
        console.error("\n❌ ALL MODELS FAILED. The API Key might be invalid, quota exceeded, or the API is down.");
    } else {
        console.log("\n✨ At least one model is working!");
    }
}

run();
