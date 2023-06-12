/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { verifyKey } from "discord-interactions";
import {
  APIInteraction,
  InteractionType,
  InteractionResponseType,
  APIInteractionResponseChannelMessageWithSource,
  APIInteractionResponseCallbackData,
  MessageFlags,
  APIApplicationCommandInteraction,
  Snowflake,
  APIChatInputApplicationCommandInteraction,
  APIApplicationCommandInteractionDataRoleOption,
  ApplicationCommandOptionType,
  APIApplicationCommandRoleOption,
} from "discord-api-types/v10";
import { KVNamespace, ExecutionContext } from "@cloudflare/workers-types";
import { isChatInputApplicationCommandInteraction } from "discord-api-types/utils/v10";

export interface Env {
  ROLES: KVNamespace;
  PUBLIC_KEY: string;
  TOKEN: string;
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const signature = req.headers.get("X-Signature-Ed25519");
    const timestamp = req.headers.get("X-Signature-Timestamp");
    const body = await req.text();
    const isValidRequest = verifyKey(
      body,
      // These are safe, because the request will fail if they are empty anyway
      String(signature),
      String(timestamp),
      env.PUBLIC_KEY
    );
    if (!isValidRequest) {
      return new Response("Bad request sig", {
        status: 401,
      });
    }
    const interaction: APIInteraction = JSON.parse(body);
    let resp_text: string;
    if (
      interaction.type === InteractionType.ApplicationCommand &&
      isChatInputApplicationCommandInteraction(interaction)
    ) {
      const data: APIInteractionResponseCallbackData = {
        content: await dispatchCommand(interaction, env.ROLES, env.TOKEN),
        flags: MessageFlags.Ephemeral,
      };
      const resp: APIInteractionResponseChannelMessageWithSource = {
        type: InteractionResponseType.ChannelMessageWithSource,
        data,
      };
      resp_text = JSON.stringify(resp);
    } else {
      resp_text = JSON.stringify({
        type: InteractionResponseType.Pong,
      });
    }
    return new Response(resp_text, {
      headers: {
        "content-type": "application/json",
      },
    });
  },
};

async function dispatchCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  kv: KVNamespace,
  token: string
): Promise<string> {
  switch (interaction.data.name) {
    case "setup":
      return await setupCommand(interaction, kv);
    case "deop":
      return await deopCommand(interaction, kv, token);
    case "reop":
      return await reopCommand(interaction, kv, token);
    default:
      return "Unrecognized command";
  }
}

async function setupCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  kv: KVNamespace
): Promise<string> {
  if (!interaction.guild_id) {
    return "This command can only be used in guilds.";
  }
  if (!interaction.data.options) {
    return "This command requires options.";
  }
  const role =
    interaction.data.options?.find<APIApplicationCommandInteractionDataRoleOption>(
      (opt): opt is APIApplicationCommandInteractionDataRoleOption =>
        opt.type === ApplicationCommandOptionType.Role
    );
  if (!role) return "Role assertion failed";
  kv.put(interaction.guild_id, role.value);
  return `Successfully set operator role to <@&${role.value}>`;
}

async function deopCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  kv: KVNamespace,
  token: string
): Promise<string> {
  if (!interaction.guild_id) {
    return "This command can only be used in guilds.";
  }
  if (!interaction.member) {
    return "Discord did not send a member object.";
  }
  const role = await getRole(kv, interaction.guild_id);
  if (!role) {
    return "No operator role is set, please run /setup";
  }
  if (interaction.member) {
    if (
      !(await delRole(
        token,
        interaction.guild_id,
        interaction.member.user.id,
        role
      ))
    ) {
      return "Failed to delete role";
    }
    return "Successfully removed role";
  } else {
    return "No member on interaction";
  }
}

async function reopCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  kv: KVNamespace,
  token: string
): Promise<string> {
  if (!interaction.guild_id) {
    return "This command can only be used in guilds.";
  }
  if (!interaction.member) {
    return "Discord did not send a member object.";
  }
  const role = await getRole(kv, interaction.guild_id);
  if (!role) {
    return "No operator role is set, please run /setup";
  }
  if (interaction.member) {
    if (
      !(await addRole(
        token,
        interaction.guild_id,
        interaction.member.user.id,
        role
      ))
    ) {
      return "Failed to add role";
    }
    return "Successfully added role";
  } else {
    return "No member on interaction";
  }
}

async function getRole(
  kv: KVNamespace,
  guild: Snowflake
): Promise<Snowflake | null> {
  return await kv.get(guild);
}

async function addRole(
  token: string,
  guild: Snowflake,
  user: Snowflake,
  role: Snowflake
): Promise<boolean> {
  const resp = await fetch(
    `https://discord.com/api/v10/guilds/${guild}/members/${user}/roles/${role}`,
    {
      headers: { Authorization: "Bot " + token },
      method: "PUT",
    }
  );
  return resp.ok;
}

async function delRole(
  token: string,
  guild: Snowflake,
  user: Snowflake,
  role: Snowflake
): Promise<boolean> {
  const resp = await fetch(
    `https://discord.com/api/v10/guilds/${guild}/members/${user}/roles/${role}`,
    {
      headers: { Authorization: "Bot " + token },
      method: "DELETE",
    }
  );
  return resp.ok;
}
