export interface YouTubePlayer {
  ad: boolean;
  skipUid?: string;
  playing: boolean;
  title: string;
}

export function inspectYouTubePlayer(snapshot: string, task: string): YouTubePlayer | undefined {
  if (!/\bplay\b/i.test(task) || !/RootWebArea .*url="https:\/\/(?:www\.)?youtube\.com\/watch\?/i.test(snapshot)) return undefined;
  const lines = snapshot.split("\n");
  const start = lines.findIndex((line) => /generic "YouTube Video Player"/.test(line));
  if (start < 0) return undefined;
  const indentation = lines[start]!.search(/\S/);
  const player: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/uid=/.test(line) && line.search(/\S/) <= indentation) break;
    player.push(line);
  }
  const controls = player.join("\n");
  const ad = /"Sponsored"|button "My Ad Center"|\bAd [0-9]+ of [0-9]+\b/i.test(controls);
  const skipUid = /uid=([\w-]+)\s+button "Skip(?: Ads?)?"/i.exec(controls)?.[1];
  const seek = player.find((line) => /slider "Seek slider"/.test(line));
  const playing = !ad && /button "Pause\b/.test(controls) && Boolean(seek && !/\bdisabled\b/.test(seek));
  const title = /RootWebArea "([^"]+)"/.exec(snapshot)?.[1] ?? "YouTube video";
  return { ad, ...(skipUid ? { skipUid } : {}), playing, title };
}
