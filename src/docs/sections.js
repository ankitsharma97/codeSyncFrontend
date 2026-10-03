import React from 'react';
import { FiBook, FiTerminal, FiGitBranch, FiGithub, FiPlay, FiAlertCircle } from 'react-icons/fi';
import { C, K, Note, Shell, Table } from './blocks';

export const SECTIONS = [
    {
        id: 'start',
        title: 'Getting started',
        icon: <FiBook />,
        body: (
            <>
                <p>CodeWithFriend is a shared coding room. Everyone with the link edits the same files, sees each other’s cursors, and shares the output, the terminal’s files and the git history.</p>
                <h3>The basics</h3>
                <ul>
                    <li><b>Share the room</b> — click the room ID at the top to copy an invite link.</li>
                    <li><b>Files and folders</b> — use the Files panel on the left. Create, rename (double-click or F2), delete, drag to move, or drop files and whole folders from your computer to import them.</li>
                    <li><b>Run code</b> — pick JavaScript or Python and press <K>Run</K> (or <K>⌘</K>/<K>Ctrl</K> + <K>Enter</K>). The output is shared with the room.</li>
                    <li><b>Preview</b> — HTML and Markdown files get a live preview. HTML files pull in the <C>.css</C> and <C>.js</C> files they reference.</li>
                    <li><b>Chat</b> — the speech-bubble button in the top bar opens a chat panel on the right. <K>Enter</K> sends, <K>Shift</K>+<K>Enter</K> adds a new line, and you can share code with triple backticks (<C>```</C>) or <C>`inline code`</C>. A red badge counts messages you haven’t read yet.</li>
                    <li><b>Terminal</b> — the <K>Terminal</K> tab at the bottom is a shell for your project, with git. See the next sections.</li>
                </ul>
                <Note title="What is shared, and what isn’t">
                    Files, the git history, the latest run output and the chat are shared with everyone in the room, and they are saved with the room — the chat history is still there when people come back (the most recent 500 messages are kept). Your terminal screen, command history and any access token you save are private to your browser.
                </Note>
            </>
        ),
    },
    {
        id: 'terminal',
        title: 'Using the terminal',
        icon: <FiTerminal />,
        body: (
            <>
                <p>Open the <K>Terminal</K> tab next to <K>Output</K> at the bottom. Drag the panel’s top edge to make it taller. It runs entirely in your browser, on your project’s files — nothing runs on the server.</p>
                <Shell>{`Ann ~ $ ls
main.js
Ann ~ $ mkdir src && echo "print('hi')" > src/hello.py
Ann ~ $ python src/hello.py
hi`}</Shell>
                <p>The project root is <C>~</C> (also <C>/</C>). The prompt shows where you are and, inside a repository, the current branch.</p>
                <h3>Commands</h3>
                <Table
                    head={['Command', 'What it does']}
                    rows={[
                        [<C>ls [-a] [-l]</C>, 'List files (-a shows dotfiles, -l shows sizes)'],
                        [<C>cd, pwd</C>, 'Move around and show where you are'],
                        [<C>cat, head, tail, wc</C>, 'Read files (head/tail take -n 5)'],
                        [<C>echo</C>, 'Print text; combine with > or >> to write files'],
                        [<C>mkdir [-p], touch</C>, 'Create folders and empty files'],
                        [<C>cp [-r], mv, rm [-rf]</C>, 'Copy, move/rename and delete'],
                        [<C>tree [-a]</C>, 'Show the folder structure'],
                        [<C>grep [-inrv]</C>, 'Search text, in files or piped input'],
                        [<C>sort, uniq</C>, 'Tidy up piped lists'],
                        [<C>open &lt;file&gt;</C>, 'Open a file in the editor'],
                        [<C>python, node</C>, 'Run a file, or inline code with -c / -e'],
                        [<C>git …</C>, 'Version control — see the next section'],
                        [<C>docs, help, clear</C>, 'Open this guide, list commands, clear the screen'],
                    ]}
                />
                <h3>Shell features</h3>
                <ul>
                    <li><b>Pipes and chaining:</b> <C>ls | grep .js</C>, <C>git log --oneline | head -3</C>, <C>mkdir a && cd a</C>, <C>cmd1; cmd2</C>.</li>
                    <li><b>Redirects:</b> <C>echo hi &gt; a.txt</C> overwrites, <C>echo more &gt;&gt; a.txt</C> appends.</li>
                    <li><b>Quotes and wildcards:</b> <C>"my file.txt"</C>, <C>rm *.log</C>, <C>git add src/*.py</C>.</li>
                </ul>
                <h3>Keyboard</h3>
                <Table
                    head={['Keys', 'Action']}
                    rows={[
                        [<K>Tab</K>, 'Complete a command or file name (press twice to list the options)'],
                        [<><K>↑</K> <K>↓</K></>, 'Browse the commands you’ve run before'],
                        [<><K>←</K> <K>→</K> <K>Home</K> <K>End</K></>, 'Move around the line (Ctrl+A / Ctrl+E also work)'],
                        [<><K>Ctrl</K>+<K>C</K></>, 'Cancel what you’re typing'],
                        [<><K>Ctrl</K>+<K>L</K></>, 'Clear the screen'],
                        [<><K>Ctrl</K>+<K>U</K> / <K>Ctrl</K>+<K>W</K></>, 'Delete the line / the previous word'],
                    ]}
                />
                <Note tone="warn" title="Not a full Linux machine">
                    There is no <C>npm</C>, <C>pip install</C>, <C>curl</C>, <C>sudo</C> or editors like <C>vim</C>. A command that is running can’t be interrupted — programs stop themselves after 8 seconds.
                </Note>
            </>
        ),
    },
    {
        id: 'run',
        title: 'Running code',
        icon: <FiPlay />,
        body: (
            <>
                <p>You can run code from the <K>Run</K> button or from the terminal. Both use the same sandbox: a locked-down worker in your browser that can’t touch the page or make network requests.</p>
                <Shell>{`$ python app.py
$ python -c "print(2 + 2)"
$ node run.js
$ node -e "console.log([1, 2, 3].map(x => x * 2))"`}</Shell>
                <h3>Using several files</h3>
                <ul>
                    <li><b>Python:</b> files can import each other — <C>from lib.helpers import greet</C> works when <C>lib/helpers.py</C> exists.</li>
                    <li><b>JavaScript:</b> use <C>require('./util.js')</C> and <C>module.exports</C>. ES <C>import</C> statements aren’t supported.</li>
                </ul>
                <Note title="Good to know">
                    The first Python run downloads the Python runtime (about 10 MB) and takes a few seconds. After that it’s instant. Terminal runs print their output when the program finishes, rather than line by line.
                </Note>
            </>
        ),
    },
    {
        id: 'git',
        title: 'Git in your room',
        icon: <FiGitBranch />,
        body: (
            <>
                <p>Every room can be a real git repository. The history is stored with the room, so <b>everyone sees the same commits, branches and tags</b>, and it’s still there when everyone leaves and comes back.</p>
                <Note title="Who gets the credit?">
                    A commit’s author is whoever typed the command, using their display name — so the log shows who did what.
                </Note>
                <h3>Your first commit</h3>
                <Shell>{`$ git init
$ git status
$ git add .
$ git commit -m "First version"
$ git log --oneline`}</Shell>
                <h3>Day to day</h3>
                <Shell>{`$ git status                # what changed?
$ git diff                  # see the changes line by line
$ git add src/app.py        # stage one file (or "git add ." for everything)
$ git commit -m "Fix the login bug"
$ git commit -am "Quick save"   # stage tracked files and commit in one go`}</Shell>
                <h3>Branches</h3>
                <Shell>{`$ git checkout -b feature        # create and switch (git switch -c feature works too)
$ git add . && git commit -m "Add feature"
$ git checkout main
$ git merge feature              # bring it in
$ git branch -d feature          # tidy up`}</Shell>
                <p>Switching branches rewrites the files in the room for everyone, so tell your teammates before you do it.</p>
                <h3>Undoing things</h3>
                <Table
                    head={['I want to…', 'Run']}
                    rows={[
                        ['Unstage a file', <C>git restore --staged &lt;file&gt;</C>],
                        ['Throw away my edits to a file', <C>git restore &lt;file&gt;</C>],
                        ['Fix the last commit message', <C>git commit --amend -m "new message"</C>],
                        ['Undo the last commit, keep the changes', <C>git reset --soft HEAD~1</C>],
                        ['Undo the last commit and the changes', <C>git reset --hard HEAD~1</C>],
                        ['Go look at an old version', <C>git checkout &lt;commit&gt;</C>],
                    ]}
                />
                <Note tone="warn" title="Be careful with --hard">
                    <C>git reset --hard</C> and <C>git restore</C> overwrite files for the whole room, and there’s no undo.
                </Note>
                <h3>Everything supported</h3>
                <p><C>init</C> <C>status</C> <C>add</C> <C>commit</C> <C>log</C> <C>diff</C> <C>show</C> <C>branch</C> <C>checkout</C> <C>switch</C> <C>restore</C> <C>reset</C> <C>merge</C> <C>tag</C> <C>rm</C> <C>mv</C> <C>remote</C> <C>clone</C> <C>fetch</C> <C>pull</C> <C>push</C> <C>config</C> <C>auth</C> — run <C>git help</C> for the short versions. A <C>.gitignore</C> file works as usual.</p>
                <Note tone="warn" title="Limits">
                    No <C>stash</C>, <C>rebase</C> or <C>cherry-pick</C>. If a merge has conflicting changes it stops and changes nothing, so fix the difference on one branch first. If two people run git commands at the exact same moment they can step on each other — talk it through first.
                </Note>
            </>
        ),
    },
    {
        id: 'github',
        title: 'GitHub and remotes',
        icon: <FiGithub />,
        body: (
            <>
                <p>You can clone, fetch, pull and push over HTTPS with GitHub, GitLab and Bitbucket. Browsers can’t reach those sites directly, so requests go through this app’s backend, which only relays git traffic to those hosts.</p>
                <h3>Clone a public repository</h3>
                <Shell>{`$ git clone https://github.com/octocat/Hello-World.git
$ cd Hello-World
$ ls
$ git log --oneline`}</Shell>
                <p>Clones are shallow (latest commit only) and land in a new folder, so keep them small — see the limits below. Only <C>https://</C> addresses work.</p>
                <h3>Push your work to GitHub</h3>
                <p>Pushing and private repositories need an access token.</p>
                <ol>
                    <li>On GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> → generate one for the repository, with <b>Contents: Read and write</b>. Give it a short expiry.</li>
                    <li>Save it in this browser, then push:</li>
                </ol>
                <Shell>{`$ git auth ghp_yourTokenHere
$ git remote add origin https://github.com/you/your-repo.git
$ git push origin main`}</Shell>
                <Note title="Where your token goes">
                    It is kept only in this browser — never in the room, so your teammates can’t see or use it. It’s sent to GitHub as a standard login header through the backend relay. Remove it any time with <C>git auth --clear</C>.
                </Note>
                <h3>Staying in sync</h3>
                <Shell>{`$ git fetch            # download new commits
$ git pull             # fetch and merge into the current branch
$ git remote -v        # show where this repo points`}</Shell>
                <Note tone="warn" title="Size limits">
                    A room can hold up to 100 files and folders, and a repository’s stored history is capped at 12 MB (1.5 MB per object). That’s plenty for small projects and demos, but a big repository won’t fit — the clone stops with a message and cleans up after itself.
                </Note>
            </>
        ),
    },
    {
        id: 'help',
        title: 'Troubleshooting',
        icon: <FiAlertCircle />,
        body: (
            <>
                <Table
                    head={['You see', 'What to do']}
                    rows={[
                        [<C>not a git repository</C>, <>Run <C>git init</C> in the project root (or <C>cd</C> into your repository).</>],
                        [<C>command not found</C>, <>Run <C>help</C> to see what the terminal supports.</>],
                        [<C>authentication required</C>, <>Private repo or a push: save a token with <C>git auth &lt;token&gt;</C>.</>],
                        [<C>could not reach the git proxy</C>, 'The backend is down or unreachable. Check your connection and try again.'],
                        [<C>access denied</C>, 'Only GitHub, GitLab and Bitbucket over https:// are allowed.'],
                        [<C>Your local changes would be overwritten</C>, <>Commit or <C>git restore</C> your edits before switching branches.</>],
                        [<C>CONFLICT in: …</C>, 'The branches changed the same lines. Make the files agree on one branch, commit, then merge again.'],
                        [<C>repository too large for a shared room</C>, 'Use a smaller repository, or clone only what you need.'],
                        [<C>Connection lost — reconnecting</C>, 'Your edits are kept and sync once you’re back online.'],
                        ['The preview is blank or shows an error', 'Reload the page (⌘/Ctrl + Shift + R).'],
                    ]}
                />
                <p>Still stuck? Type <C>help</C> or <C>git help</C> in the terminal for a quick reference.</p>
            </>
        ),
    },
];

export const findSection = (id) => SECTIONS.find((s) => s.id === id) || SECTIONS[0];
