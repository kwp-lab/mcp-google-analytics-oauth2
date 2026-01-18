#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to load OAuth2 tokens from tokens.json
function loadTokens() {
  // Try multiple paths to find tokens.json
  const possiblePaths = [
    process.env.GOOGLE_OAUTH2_TOKEN_PATH,
    path.resolve(process.cwd(), 'tokens.json'),
    path.resolve(process.cwd(), '../tokens.json'),
    path.resolve(__dirname, '../../tokens.json')
  ].filter(Boolean);

  for (const tokensPath of possiblePaths) {
    if (fs.existsSync(tokensPath)) {
      console.error(`Loading tokens from: ${tokensPath}`);
      const content = fs.readFileSync(tokensPath, 'utf8');
      return { tokens: JSON.parse(content), path: tokensPath };
    }
  }

  throw new Error(`Tokens file not found. Searched paths: ${possiblePaths.join(', ')}`);
}

// Create OAuth2Client and set credentials
const { tokens, path: tokensPath } = loadTokens();
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expiry_date: tokens.expiry_date,
  token_type: tokens.token_type,
  scope: tokens.scope
});

// Auto-refresh tokens and save to file
oauth2Client.on('tokens', (newTokens) => {
  console.error('Tokens refreshed, saving to file...');
  const updatedTokens = {
    ...tokens,
    ...newTokens,
    expiry_date: newTokens.expiry_date || Date.now() + (newTokens.expires_in || 3600) * 1000
  };
  fs.writeFileSync(tokensPath, JSON.stringify(updatedTokens, null, 2));
  console.error('Tokens saved successfully.');
});

// Create BetaAnalyticsDataClient with OAuth2Client
const analyticsDataClient = new BetaAnalyticsDataClient({
  authClient: oauth2Client
});

const server = new McpServer({
  name: 'google-analytics-mcp',
  version: '1.0.0',
});

// Helper function to handle errors with helpful messages
async function executeWithErrorHandling(fn, propertyId) {
  try {
    return await fn();
  } catch (error) {
    // Handle permission errors specifically
    if (error.code === 7 || error.message?.includes('permission')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Permission denied for this Google Analytics property',
            propertyId: propertyId,
            solution: 'The OAuth2 user does not have access to this property',
            steps: [
              '1. Ensure the authorized user has access to this GA4 property',
              '2. Check if the property ID is correct',
              '3. Re-authorize if needed to get fresh tokens'
            ],
            originalError: error.message
          }, null, 2)
        }]
      };
    }

    // Handle token errors
    if (error.message?.includes('token') || error.message?.includes('auth')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Authentication error',
            message: error.message,
            solution: 'Token may be expired or invalid. Please re-authorize to get fresh tokens.',
            propertyId: propertyId
          }, null, 2)
        }]
      };
    }

    // Handle other errors
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to fetch analytics data',
          message: error.message,
          propertyId: propertyId
        }, null, 2)
      }]
    };
  }
}

// Main analytics query tool - can handle any type of report
server.registerTool('analytics_report', {
  title: 'Analytics Report',
  description: 'Get comprehensive Google Analytics data with custom dimensions and metrics. Can create any type of report.',
  inputSchema: {
    propertyId: z.string().describe('Google Analytics property ID (e.g., 123456789). Required for all queries.'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)'),
    dimensions: z.array(z.string()).optional().describe('Dimensions to query (e.g., country, pagePath, sessionSource)'),
    metrics: z.array(z.string()).describe('Metrics to query (e.g., activeUsers, sessions, screenPageViews)'),
    dimensionFilter: z.record(z.any()).optional().describe('Filter by dimension values'),
    metricFilter: z.record(z.any()).optional().describe('Filter by metric values'),
    orderBy: z.object({
      dimension: z.string().optional(),
      metric: z.string().optional(),
      desc: z.boolean().optional().default(true)
    }).optional().describe('Sort results by dimension or metric'),
    limit: z.number().optional().default(100).describe('Limit number of results')
  }
}, async ({ propertyId, startDate, endDate, dimensions = [], metrics, dimensionFilter, metricFilter, orderBy, limit = 100 }) => {
  // Property ID is now required - no fallback to environment variable
  if (!propertyId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Property ID is required. Please specify a propertyId parameter.',
          example: 'propertyId: "123456789"',
          instruction: 'Please provide the Google Analytics 4 property ID you want to query.'
        }, null, 2)
      }]
    };
  }
  const targetPropertyId = propertyId;

  return executeWithErrorHandling(async () => {
    const reportRequest = {
      property: `properties/${targetPropertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      limit
    };

    if (dimensionFilter && Object.keys(dimensionFilter).length > 0) {
      reportRequest.dimensionFilter = dimensionFilter;
    }

    if (metricFilter && Object.keys(metricFilter).length > 0) {
      reportRequest.metricFilter = metricFilter;
    }

    if (orderBy) {
      if (orderBy.metric) {
        reportRequest.orderBys = [{ metric: { metricName: orderBy.metric }, desc: orderBy.desc }];
      } else if (orderBy.dimension) {
        reportRequest.orderBys = [{ dimension: { dimensionName: orderBy.dimension }, desc: orderBy.desc }];
      }
    }

    const [response] = await analyticsDataClient.runReport(reportRequest);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }, targetPropertyId);
});

// Real-time data tool
server.registerTool('realtime_data', {
  title: 'Real-time Data',
  description: 'Get real-time analytics data for current active users and activity',
  inputSchema: {
    propertyId: z.string().describe('Google Analytics property ID (e.g., 123456789). Required for all queries.'),
    dimensions: z.array(z.string()).optional().describe('Dimensions for real-time data (e.g., country, city, pagePath)'),
    metrics: z.array(z.string()).optional().default(['activeUsers']).describe('Real-time metrics (default: activeUsers)'),
    limit: z.number().optional().default(50).describe('Limit number of results')
  }
}, async ({ propertyId, dimensions = [], metrics = ['activeUsers'], limit = 50 }) => {
  // Property ID is now required - no fallback to environment variable
  if (!propertyId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Property ID is required. Please specify a propertyId parameter.',
          example: 'propertyId: "123456789"',
          instruction: 'Please provide the Google Analytics 4 property ID you want to query.'
        }, null, 2)
      }]
    };
  }
  const targetPropertyId = propertyId;

  return executeWithErrorHandling(async () => {
    const [response] = await analyticsDataClient.runRealtimeReport({
      property: `properties/${targetPropertyId}`,
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      limit
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }, targetPropertyId);
});

// Quick insights tool for common reports
server.registerTool('quick_insights', {
  title: 'Quick Insights',
  description: 'Get predefined analytics insights for common use cases',
  inputSchema: {
    propertyId: z.string().describe('Google Analytics property ID (e.g., 123456789). Required for all queries.'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)'),
    reportType: z.enum([
      'overview',
      'top_pages',
      'traffic_sources',
      'geographic',
      'user_demographics',
      'conversions',
      'us_states',
      'engagement_metrics',
      'ecommerce_overview',
      'device_technology'
    ]).describe('Type of quick insight report'),
    limit: z.number().optional().default(20).describe('Limit number of results')
  }
}, async ({ propertyId, startDate, endDate, reportType, limit = 20 }) => {
  // Property ID is now required - no fallback to environment variable
  if (!propertyId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Property ID is required. Please specify a propertyId parameter.',
          example: 'propertyId: "123456789"',
          instruction: 'Please provide the Google Analytics 4 property ID you want to query.'
        }, null, 2)
      }]
    };
  }
  const targetPropertyId = propertyId;

  return executeWithErrorHandling(async () => {
    let reportConfig = {};

    switch (reportType) {
      case 'overview':
        reportConfig = {
          dimensions: ['date'],
          metrics: ['activeUsers', 'sessions', 'screenPageViews', 'bounceRate', 'averageSessionDuration']
        };
        break;

      case 'top_pages':
        reportConfig = {
          dimensions: ['pagePath', 'pageTitle'],
          metrics: ['screenPageViews', 'activeUsers', 'bounceRate'],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
        };
        break;

      case 'traffic_sources':
        reportConfig = {
          dimensions: ['sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium'],
          metrics: ['sessions', 'activeUsers', 'newUsers', 'bounceRate'],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
        };
        break;

      case 'geographic':
        reportConfig = {
          dimensions: ['country', 'region', 'city'],
          metrics: ['activeUsers', 'sessions', 'newUsers', 'bounceRate'],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
        };
        break;

      case 'user_demographics':
        reportConfig = {
          dimensions: ['userAgeBracket', 'userGender', 'country'],
          metrics: ['activeUsers', 'sessions', 'averageSessionDuration', 'bounceRate']
        };
        break;

      case 'conversions':
        reportConfig = {
          dimensions: ['eventName', 'sessionDefaultChannelGroup'],
          metrics: ['conversions', 'eventCount', 'eventValue'],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              stringFilter: { matchType: 'CONTAINS', value: 'conversion' }
            }
          }
        };
        break;

      case 'us_states':
        reportConfig = {
          dimensions: ['region', 'city'],
          metrics: ['activeUsers', 'sessions', 'newUsers'],
          dimensionFilter: {
            filter: {
              fieldName: 'country',
              stringFilter: { matchType: 'EXACT', value: 'United States' }
            }
          },
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
        };
        break;

      case 'engagement_metrics':
        reportConfig = {
          dimensions: ['date'],
          metrics: ['bounceRate', 'engagementRate', 'engagedSessions', 'averageSessionDuration', 'screenPageViewsPerSession', 'userEngagementDuration']
        };
        break;

      case 'ecommerce_overview':
        reportConfig = {
          dimensions: ['date'],
          metrics: ['totalRevenue', 'transactions', 'averagePurchaseRevenue', 'itemRevenue', 'addToCarts', 'checkouts', 'ecommercePurchases']
        };
        break;

      case 'device_technology':
        reportConfig = {
          dimensions: ['deviceCategory', 'operatingSystem', 'browser'],
          metrics: ['activeUsers', 'sessions', 'bounceRate', 'averageSessionDuration'],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
        };
        break;
    }

    const reportRequest = {
      property: `properties/${targetPropertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: reportConfig.dimensions.map(name => ({ name })),
      metrics: reportConfig.metrics.map(name => ({ name })),
      limit
    };

    if (reportConfig.dimensionFilter) {
      reportRequest.dimensionFilter = reportConfig.dimensionFilter;
    }

    if (reportConfig.orderBys) {
      reportRequest.orderBys = reportConfig.orderBys;
    }

    const [response] = await analyticsDataClient.runReport(reportRequest);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }, targetPropertyId);
});

// Tool to get available dimensions and metrics
server.registerTool('get_metadata', {
  title: 'Get Analytics Metadata',
  description: 'Get available dimensions and metrics for Google Analytics property',
  inputSchema: {
    propertyId: z.string().describe('Google Analytics property ID (e.g., 123456789). Required for all queries.'),
    type: z.enum(['dimensions', 'metrics', 'both']).optional().default('both').describe('Type of metadata to retrieve')
  }
}, async ({ propertyId, type = 'both' }) => {
  // Property ID is now required - no fallback to environment variable
  if (!propertyId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Property ID is required. Please specify a propertyId parameter.',
          example: 'propertyId: "123456789"',
          instruction: 'Please provide the Google Analytics 4 property ID you want to query.'
        }, null, 2)
      }]
    };
  }
  const targetPropertyId = propertyId;

  return executeWithErrorHandling(async () => {
    const [response] = await analyticsDataClient.getMetadata({
      name: `properties/${targetPropertyId}/metadata`
    });

    let result = {};

    if (type === 'dimensions' || type === 'both') {
      result.dimensions = response.dimensions?.map(dim => ({
        apiName: dim.apiName,
        uiName: dim.uiName,
        description: dim.description,
        category: dim.category,
        customDefinition: dim.customDefinition
      })) || [];
    }

    if (type === 'metrics' || type === 'both') {
      result.metrics = response.metrics?.map(metric => ({
        apiName: metric.apiName,
        uiName: metric.uiName,
        description: metric.description,
        type: metric.type,
        category: metric.category,
        customDefinition: metric.customDefinition
      })) || [];
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }, targetPropertyId);
});

// Tool to search for specific dimensions or metrics
server.registerTool('search_metadata', {
  title: 'Search Analytics Metadata',
  description: 'Search for specific dimensions or metrics by name or category',
  inputSchema: {
    propertyId: z.string().describe('Google Analytics property ID (e.g., 123456789). Required for all queries.'),
    query: z.string().describe('Search term to find dimensions/metrics'),
    type: z.enum(['dimensions', 'metrics', 'both']).optional().default('both').describe('Type of metadata to search'),
    category: z.string().optional().describe('Filter by category (e.g., "USER", "SESSION", "PAGE", "EVENT")')
  }
}, async ({ propertyId, query, type = 'both', category }) => {
  // Property ID is now required - no fallback to environment variable
  if (!propertyId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Property ID is required. Please specify a propertyId parameter.',
          example: 'propertyId: "123456789"',
          instruction: 'Please provide the Google Analytics 4 property ID you want to query.'
        }, null, 2)
      }]
    };
  }
  const targetPropertyId = propertyId;

  return executeWithErrorHandling(async () => {
    const [response] = await analyticsDataClient.getMetadata({
      name: `properties/${targetPropertyId}/metadata`
    });

    const searchTerm = query.toLowerCase();
    let result = {};

    if (type === 'dimensions' || type === 'both') {
      result.dimensions = response.dimensions?.filter(dim => {
        const matchesSearch =
          dim.apiName?.toLowerCase().includes(searchTerm) ||
          dim.uiName?.toLowerCase().includes(searchTerm) ||
          dim.description?.toLowerCase().includes(searchTerm);

        const matchesCategory = !category || dim.category === category;

        return matchesSearch && matchesCategory;
      }).map(dim => ({
        apiName: dim.apiName,
        uiName: dim.uiName,
        description: dim.description,
        category: dim.category,
        customDefinition: dim.customDefinition
      })) || [];
    }

    if (type === 'metrics' || type === 'both') {
      result.metrics = response.metrics?.filter(metric => {
        const matchesSearch =
          metric.apiName?.toLowerCase().includes(searchTerm) ||
          metric.uiName?.toLowerCase().includes(searchTerm) ||
          metric.description?.toLowerCase().includes(searchTerm);

        const matchesCategory = !category || metric.category === category;

        return matchesSearch && matchesCategory;
      }).map(metric => ({
        apiName: metric.apiName,
        uiName: metric.uiName,
        description: metric.description,
        type: metric.type,
        category: metric.category,
        customDefinition: metric.customDefinition
      })) || [];
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }, targetPropertyId);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();