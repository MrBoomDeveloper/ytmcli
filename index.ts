#!/usr/bin/env bun

import { spawn } from "bun";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import stripIndent from 'strip-indent';

// === Configuration ===
const SCRIPT_DIR = import.meta.dir; // directory where script lives
const SONGS = ["songs/song1.mp3", "songs/song2.mp3", "songs/song3.mp3"];
const SOCKET = `/tmp/mpv-${process.pid}.sock`;

let currentIndex = 0;
let sequentialEnabled = false;
let mpvProc: ReturnType<typeof spawn> | null = null;

// === Cleanup on exit ===
function cleanup() {
	console.log("Cleaning up...");

	try { 
		unlinkSync(SOCKET); 
	} catch {}

	if(mpvProc) {
		mpvProc.kill();
	}

	process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

// === Start mpv in idle mode ===
mpvProc = spawn({
	cmd: ["mpv", "--no-terminal", `--input-ipc-server=${SOCKET}`, "--idle=yes"],
	stdout: "ignore",
	stderr: "ignore"
});

// === Helper to send IPC commands ===
function mpvCmd(json: string) {
	const net = require("net");
	const client = net.createConnection(SOCKET);
	client.write(json + "\n");
	client.end();
}

// === Core playback ===
function playCurrent() {
	const file = `${SCRIPT_DIR}/${SONGS[currentIndex]}`;
	console.log(`▶️ Now playing: ${SONGS[currentIndex]}`);
	mpvCmd(JSON.stringify({ command: ["loadfile", file, "replace"] }));
}

function nextTrackIndex() {
	currentIndex = (currentIndex + 1) % SONGS.length;
}
function prevTrackIndex() {
	currentIndex = (currentIndex - 1 + SONGS.length) % SONGS.length;
}

// === Auto-advance monitor ===
function startMonitor() {
	sequentialEnabled = true;
	
	const interval = setInterval(() => {
		if(!sequentialEnabled) {
			clearInterval(interval);
			return;
		}

		// Query idle-active
		const net = require("net");
		const client = net.createConnection(SOCKET);
		client.write(JSON.stringify({ command: ["get_property", "idle-active"] }) + "\n");

		client.on("data", (data: Buffer) => {
			const resp = data.toString();

			if(resp.includes('"data":true')) {
				nextTrackIndex();
				playCurrent();
			}
		});
		client.end();
	}, 1000);
}

function stopMonitor() {
	sequentialEnabled = false;
}

// === Menu loop ===
async function menuLoop() {
	const readline = require("readline");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	function ask(q: string): Promise<string> {
		return new Promise(resolve => rl.question(q, resolve));
	}

	while(true) {
		console.clear();
		console.log("=== YouTube Music CLI Beta ===");
		console.error("THIS IS A VERY EARLY VERSION, SO IT IS NOT PRODUCTION READY AND MANY STUFF ISN'T DONE YET!")
		console.log("Tracks:", SONGS.join(" "));
		console.log("Current track:", SONGS[currentIndex]);

		console.log(stripIndent(`
			1. Play current track
			2. Enable sequential (auto next)
			3. Disable sequential
			4. Next track
			5. Previous track
			6. Pause
			7. Resume
			8. Stop
			9. Quit
		`).trim());

		const choice = await ask("Choose: ");

		switch(choice.trim()) {
			case "1": playCurrent(); break;
			case "2": startMonitor(); playCurrent(); console.log("Sequential enabled"); break;
			case "3": stopMonitor(); console.log("Sequential disabled"); break;
			case "4": nextTrackIndex(); playCurrent(); break;
			case "5": prevTrackIndex(); playCurrent(); break;
			case "6": mpvCmd(JSON.stringify({ command: ["set_property", "pause", true] })); console.log("⏸️ Paused"); break;
			case "7": mpvCmd(JSON.stringify({ command: ["set_property", "pause", false] })); console.log("▶️ Resumed"); break;
			case "8": mpvCmd(JSON.stringify({ command: ["stop"] })); console.log("⏹️ Stopped"); break;
			case "9": rl.close(); cleanup(); return;
			default: console.log("Invalid option");
		}

		await ask("Press Enter to continue...");
	}
}

menuLoop();