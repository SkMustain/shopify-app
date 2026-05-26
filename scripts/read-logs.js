import fs from "fs";

const logPath = "C:\\Users\\Mustain\\.gemini\\antigravity-ide\\brain\\793df347-ea13-474c-b762-d1337c6489d9\\.system_generated\\logs\\transcript.jsonl";

try {
    const data = fs.readFileSync(logPath, "utf8");
    const lines = data.split("\n");
    
    console.log("Searching early logs for .gemini/.env view...");
    for (let i = 290; i < Math.min(350, lines.length); i++) {
        const line = lines[i];
        if (line && (line.includes(".gemini") || line.includes(".env"))) {
            console.log(`Line ${i}:`);
            console.log(line.slice(0, 1000));
            console.log("------------------------");
        }
    }
} catch (e) {
    console.error("Error reading log:", e.message);
}
