import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    // App Proxy requests receive a signature that must be validated
    // authenticate.public.appProxy handles this validation automatically
    const { session, cors } = await authenticate.public.appProxy(request);

    if (!session) {
        return new Response("Unauthorized", { status: 401 });
    }

    return Response.json({ status: "ok", message: "Hello from the Art Assistant API!" }, { headers: cors?.headers || {} });
};

export const action = async ({ request }) => {
    try {
        const { session, cors } = await authenticate.public.appProxy(request);

        if (!session) {
            // Return 200 with error to bypass Shopify's 500 error page
            return Response.json({ reply: "Error: Unauthorized (Session invalid)" }, { headers: cors?.headers || {} });
        }

        const payload = await request.json();
        const userMessage = (payload.message || "").toLowerCase();
        const userImage = payload.image;

        let responseData = { reply: "I can help you find art. Try asking for 'Vastu' or 'Bedroom' advice." };

        if (userImage) {
            responseData = {
                reply: "That looks like a beautiful room! Based on the colors, I recommend these modern abstract pieces:",
                type: "carousel",
                data: [
                    { title: "Abstract Blue", price: "$150", image: "https://placehold.co/600x400/2980b9/ffffff?text=Abstract+Blue" },
                    { title: "Golden Horizon", price: "$220", image: "https://placehold.co/600x400/f1c40f/ffffff?text=Golden+Horizon" }
                ]
            };
        } else if (userMessage.includes("vastu")) {
            responseData = {
                reply: "For Vastu compliance, 7 Horses paintings are excellent for success and power.",
                type: "carousel",
                data: [
                    { title: "Seven Running Horses", price: "$180", image: "https://placehold.co/600x400/e67e22/ffffff?text=7+Horses" },
                    { title: "Rising Sun", price: "$120", image: "https://placehold.co/600x400/e74c3c/ffffff?text=Rising+Sun" }
                ]
            };
        } else if (userMessage.includes("help") || userMessage.includes("choose")) {
            responseData = {
                reply: "I can guide you. What kind of vibe are you looking for?",
                type: "actions",
                data: [
                    { label: "Peaceful & Calm", payload: "Show me peaceful art" },
                    { label: "Energetic & Bold", payload: "Show me bold abstract art" },
                    { label: "Traditional", payload: "Show me traditional art" }
                ]
            };
        } else if (userMessage.includes("peaceful")) {
            responseData = {
                reply: "Peaceful art is great for bedrooms. Here are my top picks:",
                type: "carousel",
                data: [
                    { title: "Serene Lake", price: "$90", image: "https://placehold.co/600x400/3498db/ffffff?text=Serene+Lake" },
                    { title: "Forest Mist", price: "$110", image: "https://placehold.co/600x400/2ecc71/ffffff?text=Forest+Mist" }
                ]
            };
        }

        return Response.json(responseData, { headers: cors?.headers || {} });

    } catch (error) {
        console.error("Proxy Error:", error);
        // CRITICAL: Return 200 so Shopify displays this JSON instead of the 500 HTML page
        return Response.json({
            reply: `Debug Error: ${error.message} \nStack: ${error.stack}`
        }, { status: 200 });
    }
};
