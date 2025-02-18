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
}

export class QuickEmailVerificationApi {
	private apiKey: string;
	private baseUrl = 'https://api.quickemailverification.com/v1/verify';

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async verifyEmail(email: string): Promise<IEmailVerificationResponse> {
		const options: OptionsWithUri = {
			method: 'GET',
			uri: this.baseUrl,
			qs: {
				email,
				key: this.apiKey,
			},
			json: true,
		};

		try {
			const response = await this.makeRequest(options);

			if (!response.success) {
				throw new Error(response.message || 'Email verification failed');
			}

			return response;
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

	private async makeRequest(options: OptionsWithUri): Promise<IEmailVerificationResponse> {
		const { default: request } = await import('request-promise-native');
		return request(options);
	}
}
