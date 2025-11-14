const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
});

const BUCKET_NAME = process.env.BUCKET_NAME;
const API_PASSWORD = process.env.API_PASSWORD;
const PRESIGN_EXPIRES_SECONDS = parseInt(
  process.env.PRESIGN_EXPIRES_SECONDS || "3600",
  10
);

if (!BUCKET_NAME) {
  throw new Error("BUCKET_NAME environment variable is required");
}

if (!API_PASSWORD) {
  throw new Error("API_PASSWORD environment variable is required");
}

function makeCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
  };
}

function response(statusCode, bodyObj) {
  const payload = bodyObj ? JSON.stringify(bodyObj) : "";
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...makeCorsHeaders(),
    },
    body: payload,
  };
}

function parseBody(body, isBase64Encoded) {
  const decoded = isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf-8")
    : body;
  return JSON.parse(decoded);
}

function getStorageKey(requestBody) {
  if (requestBody?.key) {
    const raw = String(requestBody.key).trim();
    if (raw) {
      const safe = raw.replace(/[^a-zA-Z0-9-_.]/g, "-");
      return `user-state/${safe}.json`;
    }
  }
  return "state.json";
}

exports.handler = async (event) => {
  const method =
    event.httpMethod || event.requestContext?.http?.method || "GET";
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: makeCorsHeaders(),
      body: "",
    };
  }

  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = parseBody(event.body, event.isBase64Encoded);
    } catch (err) {
      return response(400, { error: "Request body must be valid JSON" });
    }
  }

  const password = String(parsedBody.password || "");
  if (!password) {
    return response(400, { error: "Missing password" });
  }

  if (password !== API_PASSWORD) {
    return response(401, { error: "Invalid password" });
  }

  const key = getStorageKey(parsedBody);

  try {
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: "application/json",
    });

    const writeUrl = await getSignedUrl(s3, putCommand, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const readUrl = await getSignedUrl(s3, getCommand, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    return response(200, {
      key,
      readUrl,
      writeUrl,
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return response(500, { error: "Internal server error" });
  }
};
