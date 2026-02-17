
import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const prisma = new PrismaClient();

async function listModels() {
    console.log("🔍 Reading API Key...");

    // 1. Try DB
    let apiKey = "";
    try {
        const setting = await prisma.appSetting.findUnique({
            where: { key: "GEMINI_API_KEY" }
        });
        if (setting && setting.value) {
            apiKey = setting.value;
            console.log("✅ Found API Key in Database.");
        }
    } catch (e) {
        console.warn("⚠️ failed to read from DB:", e.message);
    }

    // 2. Try Env
    if (!apiKey && process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
        console.log("✅ Found API Key in Environment Variables.");
    }

    if (!apiKey) {
        console.error("❌ No API Key found anywhere (DB or Env).");
        return;
    }

    apiKey = apiKey.trim();
    console.log(`🔑 Testing Key: ${apiKey.slice(0, 5)}...`);

    try {
        console.log("📡 Fetching available models via REST API...");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.models) {
            console.log("\n✨ AVAILABLE MODELS:");
            data.models.forEach(m => {
                console.log(`- ${m.name.replace('models/', '')} (${m.displayName})`);
            });
        } else {
            console.log("⚠️ No models found in response.");
        }

    } catch (e) {
        console.error("❌ Failed to list models:", e.message);
    }
}

listModels()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
