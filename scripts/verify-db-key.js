
import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function verify() {
    console.log("🔍 Reading API Key from Database...");
    const setting = await prisma.appSetting.findUnique({
        where: { key: "GEMINI_API_KEY" }
    });

    if (!setting || !setting.value) {
        console.error("❌ No API Key found in DB!");
        return;
    }

    const apiKey = setting.value;
    console.log(`✅ Found Key: ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);

    console.log("🤖 Testing Gemini 2.0 Flash...");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    try {
        const result = await model.generateContent("Hello, are you working?");
        console.log("✅ Gemini 2.0 Response:", result.response.text());
    } catch (e) {
        console.error("❌ Gemini 2.0 Failed:", e.message);
    }
}

verify()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
