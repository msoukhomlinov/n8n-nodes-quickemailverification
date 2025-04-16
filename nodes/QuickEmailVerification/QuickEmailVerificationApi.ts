import axios from 'axios';

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

		const url = `${this.baseUrl}?email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(this.apiKey)}`;

		try {
			const response = await this.makeRequest(url);
			const responseData = response.data;

			if (!responseData.success) {
				throw new Error(responseData.message || 'Email verification failed');
			}

			const remainingCredits = response.headers['x-qev-remaining-credits'];

			return {
				...responseData,
				remainingCredits: remainingCredits ? Number.parseInt(remainingCredits.toString(), 10) : undefined,
			};
		} catch (error: any) {
			if (axios.isAxiosError(error)) {
				if (error.response?.status === 401) {
					throw new Error('Invalid API key');
				}
				if (error.response?.status === 429) {
					throw new Error('Rate limit exceeded');
				}
			}
			throw error;
		}
	}

	private async makeRequest(url: string): Promise<{ data: IEmailVerificationResponse; headers: Record<string, unknown> }> {
		const response = await axios.get(url, {
			headers: {
				'Accept': 'application/json',
				'User-Agent': 'n8n-nodes-quickemailverification'
			}
		});

		return {
			data: response.data,
			headers: response.headers
		};
	}
}
