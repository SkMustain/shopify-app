import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, Form } from "react-router";
import { Page, Layout, Card, FormLayout, TextField, Button, Text, Banner } from "@shopify/polaris";
import { useState, useCallback } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    await authenticate.admin(request);

    // Fetch current setting
    const setting = await db.appSetting.findUnique({
        where: { key: "GEMINI_API_KEY" }
    });

    const apiKey = setting?.value || "";
    // Mask key for display if it exists
    const maskedKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "";

    return { apiKey: maskedKey, isSet: !!apiKey };
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const apiKey = formData.get("apiKey");
    const actionType = formData.get("actionType"); // 'save' or 'delete'

    if (actionType === 'delete') {
        await db.appSetting.delete({
            where: { key: "GEMINI_API_KEY" }
        });
        return { status: "success", message: "API Key removed globally." };
    }

    if (!apiKey || typeof apiKey !== "string") {
        return { status: "error", message: "Invalid API Key format." };
    }

    // Upsert the key
    await db.appSetting.upsert({
        where: { key: "GEMINI_API_KEY" },
        update: { value: apiKey },
        create: { key: "GEMINI_API_KEY", value: apiKey }
    });

    return { status: "success", message: "API Key saved successfully! The 'Real AI' is now active." };
};

export default function Settings() {
    const loaderData = useLoaderData();
    const actionData = useActionData();
    const submit = useSubmit();

    const [apiKey, setApiKey] = useState("");
    const [isDirty, setIsDirty] = useState(false);

    const handleSave = () => {
        submit({ apiKey, actionType: 'save' }, { method: "post" });
        setApiKey(""); // Clear input on save for security display
    };

    const handleDelete = () => {
        submit({ actionType: 'delete' }, { method: "post" });
    };

    return (
        <Page title="App Settings">
            <Layout>
                <Layout.Section>
                    {actionData?.message && (
                        <Banner
                            title={actionData.status === "success" ? "Success" : "Error"}
                            status={actionData.status === "success" ? "success" : "critical"}
                            onDismiss={() => { }}
                        >
                            <p>{actionData.message}</p>
                        </Banner>
                    )}

                    <Card>
                        <FormLayout>
                            <Text variant="headingMd" as="h2">Google Gemini Configuration</Text>
                            <Text as="p">
                                Enter your Google Gemini API Key here to enable the "Real AI" Art Consultant features.
                                Keys are stored securely in your database.
                            </Text>

                            <TextField
                                label="Google Gemini API Key"
                                type="password"
                                value={apiKey}
                                onChange={(val) => { setApiKey(val); setIsDirty(true); }}
                                placeholder={loaderData.isSet ? "Key is set (Hidden)" : "Enter AIza..."}
                                helpText={loaderData.isSet ? `Current Key: ${loaderData.apiKey}` : "Get a free key from Google AI Studio."}
                                autoComplete="off"
                            />

                            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                                <Button variant="primary" onClick={handleSave} disabled={!apiKey && !isDirty}>
                                    Save Key
                                </Button>
                                {loaderData.isSet && (
                                    <Button tone="critical" onClick={handleDelete}>
                                        Remove Key
                                    </Button>
                                )}
                            </div>
                        </FormLayout>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
