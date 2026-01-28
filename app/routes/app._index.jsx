import { useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Page, Layout, Card, BlockStack, TextField, Button, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSuggestions } from "../services/suggestionService";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const prompt = formData.get("prompt");

  const suggestions = await getSuggestions(prompt);

  return { suggestions };
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [prompt, setPrompt] = useState("Modern Abstract");

  const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";
  const suggestions = fetcher.data?.suggestions;

  const generateSuggestions = () => {
    fetcher.submit({ prompt }, { method: "POST" });
  };

  return (
    <Page title="Art Assistant">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Generate Product Suggestions
              </Text>
              <Text as="p">
                Enter an art style or keyword to get AI-powered product suggestions for your store.
              </Text>
              <TextField
                label="Art Style / Preference"
                value={prompt}
                onChange={(value) => setPrompt(value)}
                autoComplete="off"
                disabled={isLoading}
              />
              <Button loading={isLoading} onClick={generateSuggestions} variant="primary">
                Generate Suggestions
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {suggestions && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Results</Text>

                {suggestions.map((item, index) => (
                  <Card key={index} background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">{item.title}</Text>
                      <Text as="p">{item.description}</Text>
                      <Text as="p" fontWeight="bold">${item.price}</Text>
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
