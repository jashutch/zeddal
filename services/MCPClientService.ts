// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * MCPClientService: Manages connections to Model Context Protocol servers
 * Architecture: Optional enhancement layer for context retrieval
 *
 * Features:
 * - Connect to multiple MCP servers via stdio transport
 * - Fetch resources and prompts from servers
 * - Graceful degradation if MCP is disabled or fails
 * - Non-blocking - doesn't interrupt existing workflows
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Config } from '../utils/Config';
import { MCPServerConfig, MCPContext, MCPResource } from '../utils/Types';

interface MCPClient {
  client: Client;
  transport: StdioClientTransport;
  config: MCPServerConfig;
}

export class MCPClientService {
  private config: Config;
  private clients: Map<string, MCPClient> = new Map();
  private isInitialized: boolean = false;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initialize MCP connections
   * Called on plugin load
   */
  async initialize(): Promise<void> {
    if (!this.config.get('enableMCP')) {
      console.log('MCP is disabled in settings');
      return;
    }

    const servers = this.config.get('mcpServers');
    if (!servers || servers.length === 0) {
      console.log('No MCP servers configured');
      return;
    }

    console.log(`Initializing ${servers.length} MCP servers...`);

    for (const serverConfig of servers) {
      if (serverConfig.enabled) {
        try {
          await this.connectToServer(serverConfig);
        } catch (error) {
          console.error(`Failed to connect to MCP server ${serverConfig.name}:`, error);
          // Continue with other servers - don't let one failure block others
        }
      }
    }

    this.isInitialized = true;
    console.log(`MCP initialized with ${this.clients.size} active connections`);
  }

  /**
   * Connect to a single MCP server
   */
  private async connectToServer(serverConfig: MCPServerConfig): Promise<void> {
    try {
      console.log(`Connecting to MCP server: ${serverConfig.name}`);

      // Create stdio transport
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: serverConfig.env || {},
      });

      // Create client
      const client = new Client(
        {
          name: 'zeddal',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect
      await client.connect(transport);

      // Store client
      this.clients.set(serverConfig.id, {
        client,
        transport,
        config: serverConfig,
      });

      console.log(`Successfully connected to ${serverConfig.name}`);
    } catch (error) {
      console.error(`Failed to connect to ${serverConfig.name}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve context from all connected MCP servers
   * This is the main method called during transcription refinement
   */
  async retrieveContext(query: string): Promise<MCPContext[]> {
    if (!this.config.get('enableMCP') || !this.isInitialized) {
      return [];
    }

    if (this.clients.size === 0) {
      console.log('No active MCP connections');
      return [];
    }

    const contexts: MCPContext[] = [];

    for (const [serverId, mcpClient] of this.clients.entries()) {
      try {
        const context = await this.fetchContextFromServer(mcpClient, query);
        if (context.resources.length > 0) {
          contexts.push(context);
        }
      } catch (error) {
        console.error(`Failed to fetch context from ${mcpClient.config.name}:`, error);
        // Continue with other servers - don't let one failure block others
      }
    }

    console.log(`Retrieved context from ${contexts.length} MCP servers`);
    return contexts;
  }

  /**
   * Fetch context from a single server
   */
  private async fetchContextFromServer(
    mcpClient: MCPClient,
    query: string
  ): Promise<MCPContext> {
    const resources: MCPResource[] = [];

    try {
      // List available resources
      const resourcesResponse = await mcpClient.client.listResources();

      if (resourcesResponse.resources && resourcesResponse.resources.length > 0) {
        // Limit to first 5 resources to avoid overwhelming the LLM
        const resourcesToFetch = resourcesResponse.resources.slice(0, 5);

        for (const resource of resourcesToFetch) {
          try {
            // Read each resource
            const resourceData = await mcpClient.client.readResource({
              uri: resource.uri,
            });

            if (resourceData.contents && resourceData.contents.length > 0) {
              const content = resourceData.contents[0];

              // Only handle text content for now
              if (content.text && typeof content.text === 'string') {
                resources.push({
                  uri: resource.uri,
                  name: resource.name,
                  description: resource.description,
                  mimeType: content.mimeType || 'text/plain',
                  content: content.text,
                });
              }
            }
          } catch (error) {
            console.error(`Failed to read resource ${resource.uri}:`, error);
            // Continue with other resources
          }
        }
      }
    } catch (error) {
      console.error(`Failed to list resources from ${mcpClient.config.name}:`, error);
    }

    return {
      serverId: mcpClient.config.id,
      serverName: mcpClient.config.name,
      resources,
      timestamp: Date.now(),
    };
  }

  /**
   * Disconnect from all MCP servers
   * Called on plugin unload
   */
  async disconnect(): Promise<void> {
    console.log(`Disconnecting from ${this.clients.size} MCP servers...`);

    for (const [serverId, mcpClient] of this.clients.entries()) {
      try {
        await mcpClient.client.close();
        console.log(`Disconnected from ${mcpClient.config.name}`);
      } catch (error) {
        console.error(`Error disconnecting from ${mcpClient.config.name}:`, error);
      }
    }

    this.clients.clear();
    this.isInitialized = false;
  }

  /**
   * Reconnect to all servers (useful after settings change)
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.initialize();
  }

  /**
   * Check if MCP is available and ready
   */
  isReady(): boolean {
    return this.isInitialized && this.clients.size > 0;
  }

  /**
   * Get connection status for each server
   */
  getStatus(): { serverId: string; serverName: string; connected: boolean }[] {
    const servers = this.config.get('mcpServers');
    return servers.map((server) => ({
      serverId: server.id,
      serverName: server.name,
      connected: this.clients.has(server.id),
    }));
  }
}
