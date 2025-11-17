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
const API_URL = `${ROOT_URL}/api/`;
const TOKEN = env.LISTMONK_AUTH_TOKEN;
const API_USERNAME = "resendCampaignToUnopeners";
const basicAuth = Buffer.from(`${API_USERNAME}:${TOKEN}`).toString("base64");
const CAMPAIGN_FINISHED_STATUS = "finished";
const FOLLOW_UP_TAG = "follow-up"; // tag used to identify campaigns that need to be resent
const ALREADY_SENT_TAG = "205"; // tag used to identify campaigns that have already been sent

const getCampaignHeaders = (campaignHeaders: Campaign["headers"]) => {
  if (!campaignHeaders || campaignHeaders.length === 0) {
    return undefined;
  }

  return JSON.stringify(campaignHeaders);
};

const addSubscriber = async (subscriberData: {
  email: string;
  name: string;
  status: "enabled" | "blocklisted";
  lists?: number[];
  attribs?: Record<string, any>;
  preconfirm_subscriptions?: boolean;
}) => {
  const addSubscriberResponse = await fetch(`${API_URL}subscribers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify(subscriberData),
  }).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Error adding subscriber: ${res.statusText}: ${res.status}`
      );
    }
    return res.json();
  });

  if (!addSubscriberResponse || !addSubscriberResponse.data) {
    throw new Error("Invalid response structure from add subscriber API");
  }

  const subscriber = addSubscriberResponse.data;
  console.log(`Added subscriber: ${subscriber.email} (${subscriber.id})`);

  return subscriber;
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
        `Error fetching campaign: ${res.statusText}: ${res.status}`
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

const getSubscribersWhoDidNotOpenCampaign = async (
  campaignId: number,
  listIds: number[]
) => {
  let allSubscribers: any[] = [];
  let page = 1;
  const perPage = 1000; // Process in smaller batches

  while (true) {
    const sqlQuery = `NOT EXISTS(
      SELECT 1 FROM campaign_views
      WHERE campaign_views.subscriber_id=subscribers.id
      AND campaign_views.campaign_id=${campaignId}
    )`;

    let url = `${API_URL}subscribers?query=${encodeURIComponent(
      sqlQuery
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
          `Error fetching subscribers: ${res.statusText}: ${res.status}`
        );
      }
      return res.json();
    });

    if (!subscribersData.data || subscribersData.data.results.length === 0) {
      break;
    }

    allSubscribers = allSubscribers.concat(subscribersData.data.results);

    // Check if we've fetched all subscribers
    if (subscribersData.data.results.length < perPage) {
      break;
    }

    page++;

    // Small delay between batches to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(
    `Found ${allSubscribers.length} subscribers who did not open campaign ${campaignId}.`
  );

  return allSubscribers;
};

const createFollowUpList = async (
  subscribers: {
    id: number;
    status: string;
  }[],
  campaignName: string,
  campaignId: number
) => {
  // this will create a new list with the subscribers who did not open the campaign
  // and a description that includes `follow-up-list`

  const listName = `${campaignName}:${campaignId} - follow-up-list`;
  const listDescription = `This is a follow-up list for the campaign: ${campaignName} - follow-up-list`;

  const followUpListResponse: CreateFollowUpListResponse = await fetch(
    `${API_URL}lists`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name: listName,
        type: "private",
        optin: "single",
        description: listDescription,
        tags: [FOLLOW_UP_TAG],
      }),
    }
  ).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Error creating follow-up list: ${res.statusText}: ${res.status}`
      );
    }
    return res.json();
  });

  if (!followUpListResponse || !followUpListResponse.data) {
    throw new Error(
      "Invalid response structure from create follow-up list API"
    );
  }

  const followUpList = followUpListResponse.data;

  console.log(
    `Created follow-up list: ${followUpList.name} (${followUpList.id})`
  );

  // Now we need to add the subscribers to the new list

  const addSubscribersToListResponse: AddSubscribersToListResponse =
    await fetch(`${API_URL}subscribers/lists`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },

      body: JSON.stringify({
        ids: subscribers.map((subscriber) => subscriber.id),
        action: "add",
        target_list_ids: [followUpList.id],
        status: "confirmed", // assuming all subscribers are confirmed 💀
      }),
    }).then((res) => {
      if (!res.ok) {
        throw new Error(
          `Error adding subscribers to follow-up list: ${res.statusText}: ${res.status}`
        );
      }
      return res.json();
    });

  console.log(
    `Added ${subscribers.length} subscribers to follow-up list: ${followUpList.name} (${followUpList.id})`
  );

  if (!addSubscribersToListResponse || !addSubscribersToListResponse.data) {
    throw new Error(
      "Invalid response structure from add subscribers to follow-up list API"
    );
  }

  return followUpList;
};

const createFollowUpCampaign = async (
  campaign: Campaign,
  followUpListId: number
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
    }
  ).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Error creating follow-up campaign: ${res.statusText}: ${res.status}`
      );
    }
    return res.json();
  });

  if (!followUpCampaignResponse || !followUpCampaignResponse.data) {
    throw new Error(
      "Invalid response structure from create follow-up campaign API"
    );
  }

  const followUpCampaign = followUpCampaignResponse.data;
  console.log(
    `Created follow-up campaign: ${followUpCampaign.name} (${followUpCampaign.id})`
  );

  return followUpCampaign;
};

const cleanUpFollowUpLists = async () => {
  // this will clean up the lists we created for follow-up campaigns
  // so we will retrieve all finished campaigns with `follow-up` in their name,
  // and delete the lists associated with them, as long as the list description contains "follow-up-list"

  const finishedCampaignsData: GetCampaignsResponse = await fetch(
    `${API_URL}campaigns?status=${CAMPAIGN_FINISHED_STATUS}&per_page=all`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
    }
  ).then((res) => res.json());

  const followUpCampaigns = finishedCampaignsData.data.results.filter(
    (campaign) =>
      campaign.name.includes("follow-up") &&
      campaign.tags &&
      campaign.tags.includes(FOLLOW_UP_TAG)
  );

  console.log(
    `Found ${followUpCampaigns.length} finished follow-up campaigns.`
  );

  for (const campaign of followUpCampaigns) {
    for (const list of campaign.lists) {
      if (list.name.includes("follow-up-list")) {
        console.log(`Deleting follow-up list: ${list.name} (${list.id})`);

        const deleteListResponse = await fetch(`${API_URL}lists/${list.id}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${basicAuth}`,
          },
        });

        if (!deleteListResponse.ok) {
          console.error(
            `Error deleting follow-up list ${list.name}: ${deleteListResponse.statusText}: ${deleteListResponse.status}`
          );
        } else {
          console.log(`Deleted follow-up list: ${list.name} (${list.id})`);
        }
      }
    }
  }
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
        `Listmonk API health check failed: ${healthResponse.status}`
      );
    }

    console.log(`getting campaign with ID: ${campaignId}...`);
    const campaign = await getCampaignFromId(campaignId);

    console.log(
      `getting subscribers who did not open campaign: ${campaign.name} (${campaign.id})...`
    );
    const subscribers = await getSubscribersWhoDidNotOpenCampaign(
      campaign.id,
      campaign.lists.map((list) => list.id) ?? []
    );

    if (subscribers.length === 0) {
      console.log(
        `No subscribers to resend campaign ${campaign.name} (${campaign.id}) to.`
      );
      return;
    }

    // 1. create a new list with the subscribers who did not open the campaign, and a description that includes `follow-up-list`
    // 2. add the subscribers to the new list

    console.log(
      `Creating follow-up list for campaign: ${campaign.name} (${campaign.id})...`
    );
    const followUpList = await createFollowUpList(
      subscribers,
      campaign.name,
      campaign.id
    );

    // 3. create a new campaign with the same content as the original campaign, and the new list, with a name that includes `follow-up` and the original campaign name, and a `already-sent` tag
    // 4. send the new campaign (probably will leave it for the admin to send manually)
    console.log(
      `Creating follow-up campaign for campaign: ${campaign.name} (${campaign.id})...`
    );
    const followUpCampaign = await createFollowUpCampaign(
      campaign,
      followUpList.id
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
  console.log("resend cron job running on port 4000");
});
