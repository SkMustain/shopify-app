import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Page, Layout, Card, BlockStack, Text, Grid, DataMap, Button, TextField, InlineGrid, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // 1. Fetch Analytics
  const logs = await prisma.vastuLog.findMany();
  const directionCounts = logs.reduce((acc, log) => {
    acc[log.direction] = (acc[log.direction] || 0) + 1;
    return acc;
  }, {});

  // 2. Fetch Images (Latest 6)
  const images = await prisma.customerImage.findMany({
    take: 6,
    orderBy: { createdAt: "desc" }
  });

  // 3. Fetch Config
  const configs = await prisma.vastuConfig.findMany();

  return { directionCounts, images, configs };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const direction = formData.get("direction");
  const recommendation = formData.get("recommendation");
  const keywords = formData.get("keywords");

  if (direction && recommendation) {
    await prisma.vastuConfig.upsert({
      where: { direction },
      update: { recommendation, keywords },
      create: { direction, recommendation, keywords }
    });
  }
  return { status: "saved" };
};

export default function Index() {
  const { directionCounts, images, configs } = useLoaderData();
  const fetcher = useFetcher();

  // Config State
  const [selectedDir, setSelectedDir] = useState("North");
  const [rec, setRec] = useState("");
  const [keys, setKeys] = useState("");

  const handleDirChange = (dir) => {
    setSelectedDir(dir);
    const conf = configs.find(c => c.direction === dir);
    if (conf) {
      setRec(conf.recommendation);
      setKeys(conf.keywords);
    } else {
      setRec(""); // Reset or set default
      setKeys("");
    }
  };

  const saveConfig = () => {
    fetcher.submit({ direction: selectedDir, recommendation: rec, keywords: keys }, { method: "POST" });
  };

  return (
    <Page title="Art Assistant Dashboard">
      <Layout>
        {/* ANALYTICS SECTION */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Vastu Analytics</Text>
              <InlineGrid columns={3} gap="400">
                {Object.entries(directionCounts).map(([dir, count]) => (
                  <Box key={dir} background="bg-surface-secondary" padding="400" borderRadius="200">
                    <Text as="h3" variant="headingSm">{dir}</Text>
                    <Text as="h1" variant="headingXl">{count}</Text>
                    <Text as="p" tone="subdued">Requests</Text>
                  </Box>
                ))}
                {Object.keys(directionCounts).length === 0 && <Text tone="subdued">No data yet. Try searching "Vastu" in the chat.</Text>}
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* GALLERY SECTION */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Customer Room Gallery</Text>
              <InlineGrid columns={3} gap="200">
                {images.map(img => (
                  <div key={img.id} style={{ borderRadius: '8px', overflow: 'hidden', height: '150px', border: '1px solid #eee' }}>
                    <img src={img.imageData} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
                {images.length === 0 && <Text tone="subdued">No images uploaded yet.</Text>}
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* CONFIG PORTAL */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">AI Training Portal (Vastu Logic)</Text>
              <InlineGrid columns={["oneThird", "twoThirds"]} gap="400">
                <BlockStack gap="200">
                  <Button onClick={() => handleDirChange("North")} variant={selectedDir === "North" ? "primary" : "secondary"}>North / East</Button>
                  <Button onClick={() => handleDirChange("South")} variant={selectedDir === "South" ? "primary" : "secondary"}>South</Button>
                  <Button onClick={() => handleDirChange("West")} variant={selectedDir === "West" ? "primary" : "secondary"}>West / SW</Button>
                </BlockStack>
                <BlockStack gap="400">
                  <TextField label="AI Recommendation Text" value={rec} onChange={setRec} helpText="What the bot says to the customer." autoComplete="off" />
                  <TextField label="Search Keywords" value={keys} onChange={setKeys} helpText="Keywords passed to Shopify Search." autoComplete="off" />
                  <Button onClick={saveConfig} loading={fetcher.state === "submitting"}>Save Rule</Button>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
