// ANTIGRAVITY BRAIN v2 (Server-Side Intelligence)
// A powerful, zero-dependency local classifier and entity extractor.

export const AntigravityBrain = {

    // 1. KNOWLEDGE BASE
    vocab: {
        greetings: ["hi", "hello", "hey", "hay", "helo", "sup", "yo", "bro", "bhai", "dude", "kaise", "greetings", "namaste", "hola"],
        closings: ["bye", "goodbye", "tata", "cya", "night"],
        gratitude: ["thanks", "thank", "thx", "shukriya", "dhanaywad", "cool"],
        insults: ["stupid", "dumb", "idiot", "useless", "bot"],
        help: ["help", "support", "agent", "human"]
    },

    concepts: {
        rooms: ["living", "bedroom", "office", "kitchen", "dining", "hall", "study"],
        colors: ["blue", "red", "green", "yellow", "black", "white", "beige", "gold", "teal", "pink"],
        styles: ["modern", "abstract", "classic", "minimalist", "boho", "vintage", "nature", "landscape"]
    },

    // 2. CORE: FUZZY MATCHING (Levenshtein Distance)
    // Calculates how different two strings are. "bhaai" vs "bhai" = 1.
    getDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                }
            }
        }
        return matrix[b.length][a.length];
    },

    // Checks if input roughly matches a token (allows 1-2 typos)
    isFuzzyMatch(inputWord, targetWord) {
        // STRICTER RULE: Words < 3 chars must match EXACTLY. Prevents "i" -> "hi".
        if (targetWord.length < 3 || inputWord.length < 3) {
            return inputWord === targetWord;
        }

        if (Math.abs(inputWord.length - targetWord.length) > 2) return false;
        const dist = this.getDistance(inputWord, targetWord);
        return dist <= 1 || (targetWord.length > 5 && dist <= 2);
    },

    // 3. PROCESSOR
    process(text) {
        const t = text.toLowerCase().trim();
        const tokens = t.split(/[\s,!.?]+/);

        let result = {
            intent: "unknown",
            confidence: 0,
            entities: { rooms: [], colors: [], styles: [] },
            reply: null
        };

        // A. Entity Extraction
        tokens.forEach(word => {
            if (this.concepts.rooms.includes(word)) result.entities.rooms.push(word);
            if (this.concepts.colors.includes(word)) result.entities.colors.push(word);
            if (this.concepts.styles.includes(word)) result.entities.styles.push(word);
        });

        // B. Intent Classification (Scoring)
        let scores = { chat: 0, search: 0, refine: 0 };

        tokens.forEach(word => {
            // Fuzzy Check against Vocab
            // Skip "i" or very short words for greetings unless exact
            this.vocab.greetings.forEach(g => { if (this.isFuzzyMatch(word, g)) scores.chat += 3; });
            this.vocab.gratitude.forEach(g => { if (this.isFuzzyMatch(word, g)) scores.chat += 2; });

            // Keywords - Expanded List
            if (["buy", "price", "cost", "shipping", "canvas", "poster", "art", "painting", "paintings", "print", "prints", "decor", "frame", "wall"].includes(word)) scores.search += 2;
        });

        // Boost Search if entities found
        if (result.entities.rooms.length > 0) scores.search += 2;
        if (result.entities.colors.length > 0) scores.search += 2;

        // C. Decision Logic
        if (scores.search > scores.chat) {
            result.intent = "search";
            result.confidence = 0.8;
        } else if (scores.chat >= 2) {
            result.intent = "chat";
            result.confidence = 0.9;

            // Dynamic Reply Gen
            if (t.includes("bhai") || t.includes("bro")) {
                result.reply = "Hey Brother! 👋 How can I help you decorate your space today?";
            } else {
                result.reply = "Hello! 👋 I'm your Intelligent Art Assistant. Looking for anything specific?";
            }
        } else {
            // Ambiguous -> Let Gemini Handle
            result.intent = "unknown";
        }

        return result;
    }
};
