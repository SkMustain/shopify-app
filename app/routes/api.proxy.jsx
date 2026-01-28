import { json } from "@react-router/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    // App Proxy requests receive a signature that must be validated
    // authenticate.public.appProxy handles this validation automatically
    const { session, cors } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response("Unauthorized", { status: 401 });
    }

    return json({ status: "ok", message: "Hello from the Art Assistant API!" }, { headers: cors.headers });
};

export const action = async ({ request }) => {
    const { session, cors } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response("Unauthorized", { status: 401 });
    }

    const payload = await request.json();
    const userMessage = payload.message || "";

    // Mock AI Logic
    // In a real app, you would call OpenAI here or your suggestionService
    let aiResponse = "I can help you find the perfect art!";

    if (userMessage.toLowerCase().includes("picasso")) {
        aiResponse = "For Picasso lovers, I recommend 'Guernica' or 'The Weeping Woman'.";
    } else if (userMessage.toLowerCase().includes("van gogh")) {
        aiResponse = "If you like Van Gogh, check out 'Starry Night' or 'Sunflowers'.";
    } else if (userMessage.length > 0) {
        aiResponse = `That's a great choice! Based on "${userMessage}", I think you'd love some Abstract Expressionism.`;
    }

    return json({
        reply: aiResponse
    }, {
        headers: cors.headers
    });
};
