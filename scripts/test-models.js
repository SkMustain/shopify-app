import { GoogleGenerativeAI } from "@google/generative-ai";

// User's key from chat
const apiKey = "AIzaSyA3rEHJWmZ73V9VUUhlxlhXuV_VSlp1F_Y";
const genAI = new GoogleGenerativeAI(apiKey);

async function testConnection() {
    console.log("--- Testing Models ---");

    // 1. Try Gemini Pro (1.0) - The most stable/common one
    try {
        console.log("Attempting: gemini-pro");
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent("Hello, are you there?");
        console.log("✅ SUCCESS (gemini-pro):", result.response.text());
    } catch (e) {
        console.log("❌ FAILED (gemini-pro):", e.message.split('\n')[0]);
    }

    // 2. Try Gemini 1.5 Flash
    try {
        console.log("\nAttempting: gemini-1.5-flash");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello");
        console.log("✅ SUCCESS (gemini-1.5-flash):", result.response.text());
    } catch (e) {
        console.log("❌ FAILED (gemini-1.5-flash):", e.message.split('\n')[0]);
    }

    // 3. Try Gemini 1.5 Pro
    try {
        console.log("\nAttempting: gemini-1.5-pro");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        const result = await model.generateContent("Hello");
        console.log("✅ SUCCESS (gemini-1.5-pro):", result.response.text());
    } catch (e) {
        console.log("❌ FAILED (gemini-1.5-pro):", e.message.split('\n')[0]);
    }
}

testConnection();
