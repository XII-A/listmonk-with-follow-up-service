export type CampaignList = {
  id: number;
  name: string;
};

export type Campaign = {
  id: number;
  created_at: string;
  updated_at: string;
  views: number;
  clicks: number;
  bounces: number;
  lists: CampaignList[];
  media: any[];
  started_at: string | null;
  to_send: number;
  sent: number;
  uuid: string;
  type: string;
  name: string;
  subject: string;
  from_email: string;
  body: string;
  body_source: string | null;
  altbody: string | null;
  send_at: string | null;
  status: string;
  content_type: string;
  tags: string[];
  headers: any[];
  template_id: number | null;
  messenger: string;
  archive: boolean;
  archive_slug: string | null;
  archive_template_id: number | null;
  archive_meta: Record<string, any>;
};

export type GetCampaignsResponse = {
  data: {
    results: Campaign[];
    query: string;
    total: number;
    per_page: number;
    page: number;
  };
};

export type CreateCampaignResponse = {
  data: Campaign;
};

export type SubscriberList = {
  subscription_status: string;
  subscription_created_at: string;
  subscription_updated_at: string;
  subscription_meta: Record<string, any>;
  id: number;
  uuid: string;
  name: string;
  type: string;
  optin: string;
  tags: string[] | null;
  description: string;
  created_at: string;
  updated_at: string;
};

export type Subscriber = {
  id: number;
  created_at: string;
  updated_at: string;
  uuid: string;
  email: string;
  name: string;
  attribs: Record<string, any>;
  status: string;
  lists: SubscriberList[];
};

export type SubscribersResponse = {
  data: {
    results: Subscriber[];
    query: string;
    total: number;
    per_page: number;
    page: number;
  };
};

export type CreateFollowUpListResponse = {
  data: {
    id: number;
    created_at: string;
    updated_at: string;
    uuid: string;
    name: string;
    type: string;
    tags: string[];
    subscriber_count: number;
    description: string;
  };
};

export type AddSubscribersToListResponse = {
  data: boolean;
};

export type CreateCampaignBodyReq = {
  name: string;
  subject: string;
  lists: number[];
  from_email?: string;
  type: "regular" | "optin";
  content_type: "richtext" | "html" | "markdown" | "plain" | "visual";
  body: string;
  body_source?: string;
  altbody?: string;
  send_at?: string; // Format: 'YYYY-MM-DDTHH:MM:SSZ'
  messenger?: string;
  template_id?: number;
  tags?: string[];
  headers?: string;
};
