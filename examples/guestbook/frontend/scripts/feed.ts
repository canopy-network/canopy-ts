/**
 * Print the guestbook feed.
 *
 *   npm run feed            # newest 20
 *   npm run feed -- 100     # newest 100
 */
import { describeError, getPostCount, getPosts } from "../src/lib/guestbook.js";

async function main() {
  const limit = Number(process.argv[2] ?? 20);
  const [total, posts] = await Promise.all([getPostCount(), getPosts(limit)]);

  console.log(`${total} post(s) on-chain, showing ${posts.length}:\n`);
  for (const post of posts) {
    console.log(`#${post.id}  block ${post.height}  ${post.authorAddress}`);
    console.log(`  ${post.content}\n`);
  }
}

main().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
