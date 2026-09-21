import type { useFlueAgent } from '@flue/react';
import { useState } from 'react';

export function ChatPanel({ agent }: { agent: ReturnType<typeof useFlueAgent> }) {
	const [input, setInput] = useState('');

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		const message = input.trim();
		if (!message) return;
		setInput('');
		await agent.sendMessage(message);
	}

	return (
		<section className="chat-panel">
			<div className="chat-transcript" aria-live="polite">
				{agent.messages.length === 0 && (
					<p className="empty">
						Ask about a federal, state, county, or municipal law — e.g. "What does the
						Administrative Procedure Act require of agencies?"
					</p>
				)}
				{agent.messages
					.filter((message) => message.display === 'visible')
					.map((message) => (
						<article key={message.id} className={`message ${message.role}`}>
							<strong>{message.role === 'user' ? 'You' : 'Agent'}</strong>
							{message.parts.map((part, index) => {
								if (part.type === 'text') {
									return <p key={index}>{part.text}</p>;
								}
								if (part.type === 'dynamic-tool') {
									return (
										<p key={index} className="tool-call">
											{part.state === 'output-available'
												? `Used ${part.toolName}`
												: `Using ${part.toolName}…`}
										</p>
									);
								}
								return null;
							})}
						</article>
					))}
			</div>

			<form onSubmit={submit}>
				<input
					value={input}
					onChange={(event) => setInput(event.target.value)}
					placeholder="Ask about a law or regulation…"
				/>
				<button disabled={!input.trim()} type="submit">
					Send
				</button>
			</form>
		</section>
	);
}
