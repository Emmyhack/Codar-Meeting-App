// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Trivial change: force redeployment

contract Meeting {
    address public owner;
    uint public meetingCount;

    struct MeetingInfo {
        uint id;
        address creator;
        string title;
        string description;
        uint creationTime;
        uint scheduledTime;
        bool isPrivate;
        address[] participants;
    }

    mapping(uint => MeetingInfo) public meetings;
    mapping(uint => address[]) private meetingParticipants;

    event MeetingCreated(uint id, address creator, string title, uint scheduledTime, bool isPrivate);
    event ParticipantAdded(uint meetingId, address participant);
    event ParticipantRemoved(uint meetingId, address participant);

    constructor() {
        owner = msg.sender;
        meetingCount = 0;
    }

    function createMeeting(
        string memory title,
        string memory description,
        uint scheduledTime,
        bool isPrivate
    ) public returns (uint) {
        meetingCount++;
        MeetingInfo storage m = meetings[meetingCount];
        m.id = meetingCount;
        m.creator = msg.sender;
        m.title = title;
        m.description = description;
        m.creationTime = block.timestamp;
        m.scheduledTime = scheduledTime;
        m.isPrivate = isPrivate;
        m.participants.push(msg.sender);
        meetingParticipants[meetingCount].push(msg.sender);
        emit MeetingCreated(meetingCount, msg.sender, title, scheduledTime, isPrivate);
        return meetingCount;
    }

    function addParticipant(uint meetingId, address participant) public {
        MeetingInfo storage m = meetings[meetingId];
        require(msg.sender == m.creator, "Only creator can add participants");
        for (uint i = 0; i < m.participants.length; i++) {
            require(m.participants[i] != participant, "Already a participant");
        }
        m.participants.push(participant);
        emit ParticipantAdded(meetingId, participant);
    }

    function removeParticipant(uint meetingId, address participant) public {
        MeetingInfo storage m = meetings[meetingId];
        require(msg.sender == m.creator, "Only creator can remove participants");
        uint index = m.participants.length;
        for (uint i = 0; i < m.participants.length; i++) {
            if (m.participants[i] == participant) {
                index = i;
                break;
            }
        }
        require(index < m.participants.length, "Participant not found");
        m.participants[index] = m.participants[m.participants.length - 1];
        m.participants.pop();
        emit ParticipantRemoved(meetingId, participant);
    }

    function joinMeeting(uint meetingId) public {
        MeetingInfo storage m = meetings[meetingId];
        require(!m.isPrivate, "This meeting is private");
        for (uint i = 0; i < m.participants.length; i++) {
            require(m.participants[i] != msg.sender, "Already a participant");
        }
        m.participants.push(msg.sender);
        emit ParticipantAdded(meetingId, msg.sender);
    }

    function getMeeting(uint meetingId) public view returns (
        uint id,
        address creator,
        string memory title,
        string memory description,
        uint creationTime,
        uint scheduledTime,
        bool isPrivate,
        address[] memory participants
    ) {
        MeetingInfo storage m = meetings[meetingId];
        return (
            m.id,
            m.creator,
            m.title,
            m.description,
            m.creationTime,
            m.scheduledTime,
            m.isPrivate,
            m.participants
        );
    }

    function getParticipants(uint meetingId) public view returns (address[] memory) {
        return meetings[meetingId].participants;
    }

    function isParticipant(uint meetingId, address user) public view returns (bool) {
        MeetingInfo storage m = meetings[meetingId];
        for (uint i = 0; i < m.participants.length; i++) {
            if (m.participants[i] == user) {
                return true;
            }
        }
        return false;
    }
} 