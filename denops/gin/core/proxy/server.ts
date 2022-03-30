import {
  anonymous,
  autocmd,
  batch,
  deferred,
  Denops,
  fn,
  option,
  path,
  streams,
  unknownutil,
  vars,
} from "../../deps.ts";
import { decodeUtf8, encodeUtf8 } from "../../util/text.ts";
import * as buffer from "../../util/buffer.ts";

const recordPattern = /^([^:]+?):(.*)$/;

export async function listen(denops: Denops): Promise<void> {
  const listener = Deno.listen({
    hostname: "127.0.0.1",
    port: 0,
  });
  const [disableAskpass, disableEditor] = await batch.gather(
    denops,
    async (denops) => {
      await vars.g.get(denops, "gin_proxy_disable_askpass");
      await vars.g.get(denops, "gin_proxy_disable_editor");
    },
  );
  await batch.batch(denops, async (denops) => {
    await vars.e.set(
      denops,
      "GIN_PROXY_ADDRESS",
      JSON.stringify(listener.addr),
    );
    if (!unknownutil.ensureBoolean(disableAskpass ?? false)) {
      const script = path.fromFileUrl(new URL("askpass.ts", import.meta.url));
      await vars.e.set(
        denops,
        "GIT_ASKPASS",
        denops.meta.platform === "windows" ? `"${script}"` : `'${script}'`,
      );
    }
    if (!unknownutil.ensureBoolean(disableEditor ?? false)) {
      const script = path.fromFileUrl(new URL("editor.ts", import.meta.url));
      await vars.e.set(
        denops,
        "GIT_EDITOR",
        denops.meta.platform === "windows" ? `"${script}"` : `'${script}'`,
      );
    }
  });
  for await (const conn of listener) {
    handleConnection(denops, conn).catch((e) => console.error(e));
  }
}

async function handleConnection(
  denops: Denops,
  conn: Deno.Conn,
): Promise<void> {
  const record = decodeUtf8(await streams.readAll(conn));
  const m = record.match(recordPattern);
  if (!m) {
    throw new Error(`Unexpected record '${record}' received`);
  }
  const [name, value] = m.slice(1);
  try {
    switch (name) {
      case "askpass":
        await handleAskpass(denops, conn, value);
        break;
      case "editor":
        await handleEditor(denops, conn, value);
        break;
      default:
        throw new Error(`Unexpected record prefix '${name}' received`);
    }
  } finally {
    conn.close();
  }
}

async function handleAskpass(
  denops: Denops,
  conn: Deno.Conn,
  prompt: string,
): Promise<void> {
  try {
    const value = await fn.inputsecret(denops, prompt);
    await streams.writeAll(conn, encodeUtf8(`ok:${value}`));
  } catch (e: unknown) {
    await streams.writeAll(conn, encodeUtf8(`err:${e}`));
  }
}

async function handleEditor(
  denops: Denops,
  conn: Deno.Conn,
  filename: string,
): Promise<void> {
  try {
    await edit(denops, filename);
    await streams.writeAll(conn, encodeUtf8("ok:"));
  } catch (e: unknown) {
    await streams.writeAll(conn, encodeUtf8(`err:${e}`));
  }
}

async function edit(
  denops: Denops,
  filename: string,
): Promise<void> {
  await denops.cmd("silent noswapfile tab drop `=filename` | edit", {
    filename,
  });
  const [winid, bufnr, winnr, tabpagenr] = await batch.gather(
    denops,
    async (denops) => {
      await fn.win_getid(denops);
      await fn.bufnr(denops);
      await fn.winnr(denops);
      await fn.tabpagenr(denops);
    },
  );
  unknownutil.assertNumber(winid);
  unknownutil.assertNumber(bufnr);
  unknownutil.assertNumber(winnr);
  unknownutil.assertNumber(tabpagenr);
  if (winnr === 1 && tabpagenr === 1) {
    // This is the last buffer and should not be so add new empty tabpage
    await batch.batch(denops, async (denops) => {
      await denops.cmd("noautocmd | tabnew");
      await fn.win_gotoid(denops, winid);
      await denops.cmd("redraw");
    });
  }
  const auname = `gin_editor_${winid}_${bufnr}`;
  const waiter = deferred<void>();
  const [waiterId] = anonymous.once(denops, async () => {
    await autocmd.group(denops, auname, (helper) => {
      helper.remove();
    });
    waiter.resolve();
  });
  await buffer.ensure(denops, bufnr, async () => {
    await batch.batch(denops, async (denops) => {
      await option.bufhidden.setLocal(denops, "wipe");
      await autocmd.group(denops, auname, (helper) => {
        helper.remove();
        helper.define(
          ["BufWipeout", "VimLeave"],
          "*",
          `call denops#request('gin', '${waiterId}', [])`,
          {
            once: true,
          },
        );
      });
    });
  });
  await waiter;
}