import { ethers } from "ethers";
import MeetingABI from "../contracts/Meeting.json";

const CONTRACT_ADDRESS = "0xA7B49b3D2B75F8e88A5A846e1b4986D98E367d7C";

export default class ContractService {
  constructor(provider) {
    this.provider = provider;
    this.contract = null;
    this.signerContract = null;
    this.initializeContracts();
  }

  async initializeContracts() {
    // Read-only contract (provider only)
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, MeetingABI.abi, this.provider);
    // Write contract (signer, if available)
    if (this.provider.getSigner) {
      try {
        const signer = await this.provider.getSigner();
        this.signerContract = new ethers.Contract(CONTRACT_ADDRESS, MeetingABI.abi, signer);
      } catch (e) {
        this.signerContract = null;
      }
    }
  }

  async getMeetingCount() {
    if (!this.contract) {
      await this.initializeContracts();
    }
    return await this.contract.meetingCount();
  }

  async createMeeting(title, description, date, isPrivate) {
    if (!this.signerContract) {
      await this.initializeContracts();
    }
    if (!this.signerContract) throw new Error("No signer available for contract write operation");
    return await this.signerContract.createMeeting(title, description, date, isPrivate);
  }

  async getMeeting(meetingId) {
    if (!this.contract) {
      await this.initializeContracts();
    }
    return await this.contract.getMeeting(meetingId);
  }

  async getAllMeetings() {
    if (!this.contract) {
      await this.initializeContracts();
    }
      const count = await this.getMeetingCount();
      const meetings = [];
      for (let i = 1; i <= count; i++) {
        try {
          const meeting = await this.getMeeting(i);
          meetings.push(meeting);
      } catch (e) {
        // skip if not found
      }
    }
    return meetings;
  }

  async getParticipants(meetingId) {
    if (!this.contract) {
      await this.initializeContracts();
    }
    return await this.contract.getParticipants(meetingId);
  }

  async joinMeeting(meetingId) {
    if (!this.signerContract) {
      await this.initializeContracts();
    }
    if (!this.signerContract) throw new Error("No signer available for contract write operation");
    return await this.signerContract.joinMeeting(meetingId);
  }
} 