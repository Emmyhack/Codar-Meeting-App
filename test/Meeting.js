const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Meeting Contract", function () {
  let Meeting, meeting, owner, addr1, addr2, addr3;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    Meeting = await ethers.getContractFactory("Meeting");
    meeting = await Meeting.deploy();
  });

  it("should create a meeting with correct details", async function () {
    const tx = await meeting.createMeeting(
      "Team Sync",
      "Weekly team meeting",
      Math.floor(Date.now() / 1000) + 3600,
      false
    );
    const receipt = await tx.wait();
    let meetingId;
    for (const log of receipt.logs) {
      try {
        const parsed = meeting.interface.parseLog(log);
        if (parsed.name === "MeetingCreated") {
          meetingId = parsed.args.id;
          break;
        }
      } catch (e) {
        // Not this event, skip
      }
    }
    expect(meetingId).to.not.be.undefined;
    const m = await meeting.getMeeting(meetingId);
    expect(m.title).to.equal("Team Sync");
    expect(m.description).to.equal("Weekly team meeting");
    expect(m.creator).to.equal(owner.address);
    expect(m.isPrivate).to.equal(false);
    const participants = await meeting.getParticipants(meetingId);
    expect(participants[0]).to.equal(owner.address);
  });

  it("should allow the creator to add and remove participants", async function () {
    await meeting.createMeeting("Test", "Desc", 0, false);
    await expect(meeting.addParticipant(1, addr1.address))
      .to.emit(meeting, "ParticipantAdded")
      .withArgs(1, addr1.address);
    let participants = await meeting.getParticipants(1);
    expect(participants).to.include(addr1.address);
    await expect(meeting.removeParticipant(1, addr1.address))
      .to.emit(meeting, "ParticipantRemoved")
      .withArgs(1, addr1.address);
    participants = await meeting.getParticipants(1);
    expect(participants).to.not.include(addr1.address);
  });

  it("should not allow non-creator to add or remove participants", async function () {
    await meeting.createMeeting("Test", "Desc", 0, false);
    await expect(
      meeting.connect(addr1).addParticipant(1, addr2.address)
    ).to.be.revertedWith("Only creator can add participants");
    await expect(
      meeting.connect(addr1).removeParticipant(1, owner.address)
    ).to.be.revertedWith("Only creator can remove participants");
  });

  it("should allow anyone to join a public meeting", async function () {
    await meeting.createMeeting("Public", "Desc", 0, false);
    await expect(meeting.connect(addr1).joinMeeting(1))
      .to.emit(meeting, "ParticipantAdded")
      .withArgs(1, addr1.address);
    const participants = await meeting.getParticipants(1);
    expect(participants).to.include(addr1.address);
  });

  it("should not allow anyone to join a private meeting", async function () {
    await meeting.createMeeting("Private", "Desc", 0, true);
    await expect(meeting.connect(addr1).joinMeeting(1)).to.be.revertedWith(
      "This meeting is private"
    );
  });

  it("should not allow duplicate participants", async function () {
    await meeting.createMeeting("Test", "Desc", 0, false);
    await meeting.addParticipant(1, addr1.address);
    await expect(meeting.addParticipant(1, addr1.address)).to.be.revertedWith(
      "Already a participant"
    );
    await expect(meeting.connect(addr1).joinMeeting(1)).to.be.revertedWith(
      "Already a participant"
    );
  });

  it("should return correct participant status", async function () {
    await meeting.createMeeting("Test", "Desc", 0, false);
    expect(await meeting.isParticipant(1, owner.address)).to.equal(true);
    expect(await meeting.isParticipant(1, addr1.address)).to.equal(false);
    await meeting.addParticipant(1, addr1.address);
    expect(await meeting.isParticipant(1, addr1.address)).to.equal(true);
  });
}); 