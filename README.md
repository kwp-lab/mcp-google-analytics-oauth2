# Google Analytics MCP Server (OAuth2 User Authorization)

A Model Context Protocol (MCP) server that provides seamless access to Google Analytics 4 data through standard MCP interfaces. This tool allows LLM applications to easily query and analyze Google Analytics data without directly dealing with the complexities of the Google Analytics Data API.

## ✨ Features

- **🔐 OAuth2 User Authorization**: Access GA data using user's OAuth2 tokens (not just service accounts)
- **Real-time Data Access**: Get real-time analytics data for current active users and activity
- **Custom Reports**: Create comprehensive reports with custom dimensions and metrics
- **Quick Insights**: Predefined analytics insights for common use cases
- **Metadata Discovery**: Get available dimensions and metrics for your Google Analytics property
- **🔄 Auto Token Refresh**: Automatically refreshes expired access tokens and saves them
- **Smart Error Handling**: Detailed error messages with actionable solutions for permission issues
- **Standard MCP Interface**: Works with any MCP-compatible client

## Installation

```bash
npm install @toolsdk.ai/google-analytics-mcp
```

## Prerequisites

- Node.js >= 18.0.0
- Google Analytics 4 property
- OAuth2 tokens from a Google Cloud OAuth2 authorization flow

## Setup

### OAuth2 Authorization (User Consent Flow)

This MCP server uses **OAuth2 User Authorization** to access Google Analytics data on behalf of the user. This means:

- ✅ Access the user's own GA properties without service account setup
- ✅ No need to add service accounts to GA property permissions
- ✅ Works with the user's existing Google account permissions

> ⚠️ **Important**: This MCP server does **NOT** include the OAuth2 authorization flow itself. You need to implement the OAuth2 consent flow separately to obtain the tokens.

### 1. Implement OAuth2 Authorization Flow (Your Responsibility)

You need to implement the OAuth2 authorization flow using libraries like:

- [`googleapis`](https://www.npmjs.com/package/googleapis) (Node.js)
- [`google-auth-library`](https://www.npmjs.com/package/google-auth-library) (Node.js)
- Or any OAuth2 library for your platform

Required OAuth2 scopes:
```
https://www.googleapis.com/auth/analytics.readonly
```

Example OAuth2 flow (simplified):
```javascript
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Generate auth URL and redirect user
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',  // Important: to get refresh_token
  scope: ['https://www.googleapis.com/auth/analytics.readonly']
});

// After user consent, exchange code for tokens
const { tokens } = await oauth2Client.getToken(code);

// Save tokens to tokens.json
fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
```

### 2. tokens.json Format

After completing the OAuth2 flow, save the tokens in a `tokens.json` file with this format:

```json
{
  "access_token": "ya29.a0AWY7CknXXX...",
  "refresh_token": "1//0eXXX...",
  "scope": "https://www.googleapis.com/auth/analytics.readonly",
  "token_type": "Bearer",
  "expiry_date": 1234567890000
}
```

| Field | Description | Required |
|-------|-------------|----------|
| `access_token` | The OAuth2 access token | ✅ Yes |
| `refresh_token` | The refresh token (for auto-renewal) | ⚠️ Recommended |
| `scope` | Authorized scopes | Optional |
| `token_type` | Token type (usually "Bearer") | Optional |
| `expiry_date` | Token expiration timestamp (ms) | ⚠️ Recommended |

### 3. tokens.json File Location

The MCP server searches for `tokens.json` in the following order:

1. Path specified by `GOOGLE_OAUTH2_TOKEN_PATH` environment variable
2. `{current working directory}/tokens.json`
3. `{current working directory}/../tokens.json`
4. `{src directory}/../../tokens.json`

### 4. Environment Configuration (Optional)

For automatic token refresh, you can optionally provide your OAuth2 client credentials:

```env
# Optional: Path to tokens.json (if not in default location)
GOOGLE_OAUTH2_TOKEN_PATH=/path/to/your/tokens.json

# Optional: For automatic token refresh
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

## ⚠️ Token Lifecycle Management

### Access Token Expiration

- Google OAuth2 access tokens typically expire after **1 hour**
- The MCP server will automatically attempt to refresh tokens if `refresh_token` is provided

### Automatic Token Refresh

When configured with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, the server will:

1. Detect when the access token is expired
2. Use the `refresh_token` to obtain a new `access_token`
3. **Automatically save** the new tokens to `tokens.json`

### Refresh Token Considerations

> ⚠️ **Important Notes about Refresh Tokens:**

1. **Refresh tokens can expire or be revoked:**
   - If the user revokes access in their Google Account settings
   - If the refresh token is unused for 6 months (for non-verified apps)
   - If you've exceeded the limit of 100 refresh tokens per user per client

2. **Getting a refresh token:**
   - You only get a `refresh_token` on the **first** authorization
   - Use `access_type: 'offline'` in your auth URL
   - Use `prompt: 'consent'` to force re-consent and get a new refresh token

3. **Recommended practices:**
   - Always request `access_type: 'offline'` during OAuth2 flow
   - Store and protect the `refresh_token` securely
   - Implement re-authorization flow for when refresh tokens become invalid
   - Monitor for `invalid_grant` errors which indicate the refresh token is no longer valid

### Handling Token Errors

If you encounter authentication errors:

1. Check if `tokens.json` exists and contains valid tokens
2. Verify the `access_token` hasn't expired (check `expiry_date`)
3. If refresh fails, re-run your OAuth2 authorization flow to get new tokens
4. Ensure the authorized user has access to the GA4 property

## Usage

### Use with Claude Desktop

```json
{
  "mcpServers": {
    "google-analytics-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@toolsdk.ai/google-analytics-mcp"
      ],
      "env": {
        "GOOGLE_OAUTH2_TOKEN_PATH": "/path/to/your/tokens.json",
        "GOOGLE_CLIENT_ID": "your-client-id (optional, for token refresh)",
        "GOOGLE_CLIENT_SECRET": "your-client-secret (optional, for token refresh)"
      }
    }
  }
}
```


## Available Tools

### `analytics_report`
Get comprehensive Google Analytics data with custom dimensions and metrics. Can create any type of report.

Parameters:
- `propertyId` (string, required): Google Analytics property ID
- `startDate` (string, required): Start date (YYYY-MM-DD)
- `endDate` (string, required): End date (YYYY-MM-DD)
- `dimensions` (array, optional): Dimensions to query
- `metrics` (array, required): Metrics to query
- `dimensionFilter` (object, optional): Filter by dimension values
- `metricFilter` (object, optional): Filter by metric values
- `orderBy` (object, optional): Sort results by dimension or metric
- `limit` (number, optional): Limit number of results (default: 100)

### `realtime_data`
Get real-time analytics data for current active users and activity.

Parameters:
- `propertyId` (string, required): Google Analytics property ID
- `dimensions` (array, optional): Dimensions for real-time data
- `metrics` (array, optional): Real-time metrics (default: ['activeUsers'])
- `limit` (number, optional): Limit number of results (default: 50)

### `quick_insights`
Get predefined analytics insights for common use cases.

Parameters:
- `propertyId` (string, required): Google Analytics property ID
- `startDate` (string, required): Start date (YYYY-MM-DD)
- `endDate` (string, required): End date (YYYY-MM-DD)
- `reportType` (string, required): Type of quick insight report (overview, top_pages, traffic_sources, etc.)
- `limit` (number, optional): Limit number of results (default: 20)

### `get_metadata`
Get available dimensions and metrics for Google Analytics property.

Parameters:
- `propertyId` (string, required): Google Analytics property ID
- `type` (string, optional): Type of metadata to retrieve (dimensions, metrics, both)

### `search_metadata`
Search for specific dimensions or metrics by name or category.

Parameters:
- `propertyId` (string, required): Google Analytics property ID
- `query` (string, required): Search term to find dimensions/metrics
- `type` (string, optional): Type of metadata to search (dimensions, metrics, both)
- `category` (string, optional): Filter by category

## Error Handling

The server provides detailed error messages with actionable solutions:

- **Permission Errors**: Clear instructions when the OAuth2 user doesn't have access to the GA property
- **Authentication Errors**: Guidance on token issues and re-authorization
- **API Errors**: Detailed information about what went wrong with the Google Analytics API

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT