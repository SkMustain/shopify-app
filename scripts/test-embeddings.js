import { GoogleGenerativeAI } from "@google/generative-ai";
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function testEmbeddings() {
    console.log("--- Testing Gemini Embedding Generation via DB Key ---");
    
    try {
        // Fetch API key from DB
        const apiKeyObj = await prisma.appSetting.findUnique({
            where: { key: "GEMINI_API_KEY" }
        });
        const apiKey = apiKeyObj?.value;

        if (!apiKey) {
            console.error("❌ Error: GEMINI_API_KEY not found in database settings table.");
            console.log("Please make sure you have saved your Gemini API Key in the Art Assistant Dashboard first!");
            process.exit(1);
        }

        console.log("🔑 Retrieved Gemini API Key from database successfully.");
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
        
        console.log("Attempting embedding generation for: 'calming blue living room art'...");
        const result = await model.embedContent("calming blue living room art");
        const embedding = result.embedding?.values;

        if (embedding && embedding.length > 0) {
            console.log("✅ SUCCESS! Embedding vector generated successfully.");
            console.log(`Dimensions count: ${embedding.length} (Expected: 768)`);
            console.log(`First 5 values: ${JSON.stringify(embedding.slice(0, 5))}...`);
        } else {
            console.error("❌ FAILED: Received empty embedding from API.");
        }
    } catch (e) {
        console.error("❌ FAILED to generate embedding:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

testEmbeddings();
