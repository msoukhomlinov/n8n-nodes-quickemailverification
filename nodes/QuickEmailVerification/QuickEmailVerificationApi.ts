import type { OptionsWithUri } from 'request-promise-native';

export interface IEmailVerificationResponse {
	result: 'valid' | 'invalid' | 'unknown';
	reason: string;
	disposable: boolean;
	accept_all: boolean;
	role: boolean;
	free: boolean;
	email: string;
	user: string;
	domain: string;
	mx_record: boolean;
	mx_domain: string;
	safe_to_send: boolean;
	did_you_mean: string;
	success: boolean;
	message: string | null;
	verifiedAt?: string;
	remainingCredits?: number;
}

export class QuickEmailVerificationApi {
	private apiKey: string;
	private baseUrl = 'https://api.quickemailverification.com/v1/verify';

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async verifyEmail(email: string): Promise<IEmailVerificationResponse> {
		if (!email || !this.apiKey) {
			throw new Error('Email and API key are required');
		}

		const options: OptionsWithUri = {
			method: 'GET',
			uri: `${this.baseUrl}?email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(this.apiKey)}`,
			json: true,
			resolveWithFullResponse: true,
		};

		try {
			const fullResponse = await this.makeRequest(options);
			const response = fullResponse.body;

			if (!response.success) {
				throw new Error(response.message || 'Email verification failed');
			}

			const remainingCredits = fullResponse.headers['x-qev-remaining-credits'];

			return {
				...response,
				remainingCredits: remainingCredits ? Number.parseInt(remainingCredits.toString(), 10) : undefined,
			};
		} catch (error) {
			const err = error as { statusCode?: number };
			if (err.statusCode === 401) {
				throw new Error('Invalid API key');
			}
			if (err.statusCode === 429) {
				throw new Error('Rate limit exceeded');
			}
			throw error;
		}
	}

	private async makeRequest(options: OptionsWithUri): Promise<{ body: IEmailVerificationResponse; headers: Record<string, unknown> }> {
		const { default: request } = await import('request-promise-native');
		return request(options);
	}
}
