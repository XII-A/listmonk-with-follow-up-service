import { config } from "dotenv";
import {
  AddSubscribersToListResponse,
  Campaign,
  GetCampaignsResponse,
  CreateFollowUpListResponse,
  SubscribersResponse,
  CreateCampaignResponse,
  CreateCampaignBodyReq,
} from "./types";
import express from "express";

const env = process.env as any;
config({ path: ".env.development" });
const ROOT_URL = "http://app:9000";
// const ROOT_URL = "https://mail-list.erpslick.com";
const API_URL = `${ROOT_URL}/api/`;
const TOKEN = env.LISTMONK_AUTH_TOKEN;
const API_USERNAME = "resendCampaignToUnopeners";
const basicAuth = Buffer.from(`${API_USERNAME}:${TOKEN}`).toString("base64");
const FOLLOW_UP_TAG = "follow-up"; // tag used to identify campaigns that need to be resent

const getCampaignHeaders = (campaignHeaders: Campaign["headers"]) => {
  if (!campaignHeaders || campaignHeaders.length === 0) {
    return undefined;
  }

  return JSON.stringify(campaignHeaders);
};

const getCampaignFromId = async (campaignId: number) => {
  const campaignData: {
    data: Campaign;
  } = await fetch(`${API_URL}campaigns/${campaignId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
  }).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Error fetching campaign: ${res.statusText}: ${res.status}`,
      );
    }
    return res.json();
  });

  if (!campaignData || !campaignData.data) {
    throw new Error("Invalid response structure from campaign API");
  }

  const campaign = campaignData.data;

  console.log(`Fetched campaign: ${campaign.name} (${campaign.id})`);
  return campaign;
};

const getSubscribersWhoDidNotOpenCampaign = async function* (
  campaignId: number,
  listIds: number[],
) {
  let page = 1;
  const perPage = 1000;
  let totalProcessed = 0;

  while (true) {
    const sqlQuery = `NOT EXISTS(
      SELECT 1 FROM campaign_views
      WHERE campaign_views.subscriber_id=subscribers.id
      AND campaign_views.campaign_id=${campaignId}
    )`;

    let url = `${API_URL}subscribers?query=${encodeURIComponent(
      sqlQuery,
    )}&page=${page}&per_page=${perPage}`;

    if (listIds.length > 0) {
      url += listIds.map((listId) => `&list_id=${listId}`).join("");
    }

    const subscribersData: SubscribersResponse = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
    }).then((res) => {
      if (!res.ok) {
        throw new Error(
          `Error fetching subscribers: ${res.statusText}: ${res.status}`,
        );
      }
      return res.json();
    });

    if (!subscribersData.data || subscribersData.data.results.length === 0) {
      break;
    }

    const batch = subscribersData.data.results;
    // ensure that the batch only contains unique ids
    const uniqueIds = [...new Set(batch.map((subscriber) => subscriber.id))];

    if (uniqueIds.length !== batch.length) {
      console.warn(
        `Warning: batch contains duplicate subscriber IDs. Unique IDs: ${uniqueIds.length}, Batch size: ${batch.length}`,
      );
    }

    totalProcessed += batch.length;

    console.log(
      `Fetched batch ${page}: ${batch.length} subscribers (total: ${totalProcessed})`,
    );

    yield uniqueIds;

    if (batch.length < perPage) {
      break;
    }

    page++;
  }

  console.log(
    `Found ${totalProcessed} total subscribers who did not open campaign ${campaignId}.`,
  );
};

const createFollowUpCampaign = async (
  campaign: Campaign,
  followUpListId: number,
) => {
  // this will create a new campaign with the same content as the original campaign,
  // and the new list, with a name that includes `follow-up` and the original campaign name,
  // and a `already-sent` tag

  const followUpCampaignName = `${campaign.name} - follow-up`;

  const followUpCampaignReqBody: CreateCampaignBodyReq = {
    name: followUpCampaignName,
    subject: campaign.subject,
    lists: [followUpListId],
    from_email: campaign.from_email,
    type: campaign.type as "regular",
    content_type: campaign.content_type as "richtext",
    body: campaign.body,
    body_source: campaign.body_source ?? undefined,
    altbody: campaign.altbody ?? undefined,
    messenger: campaign.messenger ?? undefined,
    template_id: campaign.template_id ?? undefined,
    tags: [FOLLOW_UP_TAG],
    headers: getCampaignHeaders(campaign.headers),
  };

  const followUpCampaignResponse: CreateCampaignResponse = await fetch(
    `${API_URL}campaigns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(followUpCampaignReqBody),
    },
  ).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Error creating follow-up campaign: ${res.statusText}: ${res.status}`,
      );
    }
    return res.json();
  });

  if (!followUpCampaignResponse || !followUpCampaignResponse.data) {
    throw new Error(
      "Invalid response structure from create follow-up campaign API",
    );
  }

  const followUpCampaign = followUpCampaignResponse.data;
  console.log(
    `Created follow-up campaign: ${followUpCampaign.name} (${followUpCampaign.id})`,
  );

  return followUpCampaign;
};

const resendService = async (campaignId: number) => {
  try {
    console.log("Starting resend campaign process...");

    const healthResponse = await fetch(`${API_URL}health`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
    });

    if (!healthResponse.ok) {
      throw new Error(
        `Listmonk API health check failed: ${healthResponse.status}`,
      );
    }

    console.log(`getting campaign with ID: ${campaignId}...`);
    const campaign = await getCampaignFromId(campaignId);

    console.log(
      `getting subscribers who did not open campaign: ${campaign.name} (${campaign.id})...`,
    );

    // Create the follow-up list first (empty)
    const followUpListName = `${campaign.name}:${campaign.id} - follow-up-list`;
    const followUpListDescription = `This is a follow-up list for the campaign: ${campaign.name} - follow-up-list`;

    const followUpListResponse: CreateFollowUpListResponse = await fetch(
      `${API_URL}lists`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          name: followUpListName,
          type: "private",
          optin: "single",
          description: followUpListDescription,
          tags: [FOLLOW_UP_TAG],
        }),
      },
    ).then((res) => {
      if (!res.ok) {
        throw new Error(
          `Error creating follow-up list: ${res.statusText}: ${res.status}`,
        );
      }
      return res.json();
    });

    const followUpList = followUpListResponse.data;
    console.log(
      `Created follow-up list: ${followUpList.name} (${followUpList.id}) for campaign: ${campaign.name} (${campaign.id})`,
    );

    // Process subscribers in batches
    let totalSubscribers = 0;
    for await (const subscriberBatch of getSubscribersWhoDidNotOpenCampaign(
      campaign.id,
      campaign.lists.map((list) => list.id) ?? [],
    )) {
      // Add this batch to the follow-up list
      await fetch(`${API_URL}subscribers/lists`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          ids: subscriberBatch,
          action: "add",
          target_list_ids: [followUpList.id],
          status: "confirmed",
        }),
      }).then((res) => {
        if (!res.ok) {
          console.log("e", res);
          throw new Error(
            `Error adding subscribers to follow-up list: ${res.statusText}: ${res.status}`,
          );
        }
        return res.json();
      });

      totalSubscribers += subscriberBatch.length;
      console.log(
        `Added batch of ${subscriberBatch.length} subscribers to follow-up list (total: ${totalSubscribers}) for campaign: ${campaign.name} (${campaign.id})...`,
      );
    }

    if (totalSubscribers === 0) {
      console.log(
        `No subscribers to resend campaign ${campaign.name} (${campaign.id}) to.`,
      );
      // Delete the empty list
      await fetch(`${API_URL}lists/${followUpList.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
      });
      return;
    }

    console.log(
      `Creating follow-up campaign for campaign: ${campaign.name} (${campaign.id})...`,
    );
    const followUpCampaign = await createFollowUpCampaign(
      campaign,
      followUpList.id,
    );

    console.log(
      `✓ Successfully created follow-up campaign for ${totalSubscribers} subscribers`,
    );
  } catch (error) {
    console.error("Error in main function:", error);
    throw error;
  }
};

const app = express();
app.use(express.json());

app.post("/run/:campaignId", async (req, res) => {
  try {
    const campaignId = Number(req.params.campaignId);
    await resendService(campaignId);
    res.status(200).send("Resend cron job completed successfully.");
  } catch (error) {
    console.error("Error in resend cron job:", error);
    res.status(500).send("Error in resend cron job.");
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "working",
    listmonkUrl: ROOT_URL,
    hasToken: !!TOKEN,
  });
});

app.listen(4000, () => {
  console.log("resend service V2 running on port 4000");
});
