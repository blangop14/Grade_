pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialTranscript is ZamaEthereumConfig {
    
    struct Transcript {
        string studentId;                    
        euint32 encryptedGPA;                
        uint256 publicData1;                 
        uint256 publicData2;                 
        string institution;                  
        address issuer;                      
        uint256 issueDate;                   
        uint32 decryptedGPA; 
        bool isVerified; 
    }
    

    mapping(string => Transcript) public transcripts;
    
    string[] public transcriptIds;
    
    event TranscriptIssued(string indexed transcriptId, address indexed issuer);
    event GPADecrypted(string indexed transcriptId, uint32 decryptedGPA);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function issueTranscript(
        string calldata transcriptId,
        string calldata studentId,
        externalEuint32 encryptedGPA,
        bytes calldata inputProof,
        uint256 publicData1,
        uint256 publicData2,
        string calldata institution
    ) external {
        require(bytes(transcripts[transcriptId].studentId).length == 0, "Transcript already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedGPA, inputProof)), "Invalid encrypted input");
        
        transcripts[transcriptId] = Transcript({
            studentId: studentId,
            encryptedGPA: FHE.fromExternal(encryptedGPA, inputProof),
            publicData1: publicData1,
            publicData2: publicData2,
            institution: institution,
            issuer: msg.sender,
            issueDate: block.timestamp,
            decryptedGPA: 0,
            isVerified: false
        });
        
        FHE.allowThis(transcripts[transcriptId].encryptedGPA);
        
        FHE.makePubliclyDecryptable(transcripts[transcriptId].encryptedGPA);
        
        transcriptIds.push(transcriptId);
        
        emit TranscriptIssued(transcriptId, msg.sender);
    }
    
    function verifyGPA(
        string calldata transcriptId, 
        bytes memory abiEncodedClearGPA,
        bytes memory decryptionProof
    ) external {
        require(bytes(transcripts[transcriptId].studentId).length > 0, "Transcript does not exist");
        require(!transcripts[transcriptId].isVerified, "GPA already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(transcripts[transcriptId].encryptedGPA);
        
        FHE.checkSignatures(cts, abiEncodedClearGPA, decryptionProof);
        
        uint32 decodedGPA = abi.decode(abiEncodedClearGPA, (uint32));
        
        transcripts[transcriptId].decryptedGPA = decodedGPA;
        transcripts[transcriptId].isVerified = true;
        
        emit GPADecrypted(transcriptId, decodedGPA);
    }
    
    function getEncryptedGPA(string calldata transcriptId) external view returns (euint32) {
        require(bytes(transcripts[transcriptId].studentId).length > 0, "Transcript does not exist");
        return transcripts[transcriptId].encryptedGPA;
    }
    
    function getTranscript(string calldata transcriptId) external view returns (
        string memory studentId,
        uint256 publicData1,
        uint256 publicData2,
        string memory institution,
        address issuer,
        uint256 issueDate,
        bool isVerified,
        uint32 decryptedGPA
    ) {
        require(bytes(transcripts[transcriptId].studentId).length > 0, "Transcript does not exist");
        Transcript storage data = transcripts[transcriptId];
        
        return (
            data.studentId,
            data.publicData1,
            data.publicData2,
            data.institution,
            data.issuer,
            data.issueDate,
            data.isVerified,
            data.decryptedGPA
        );
    }
    
    function getAllTranscriptIds() external view returns (string[] memory) {
        return transcriptIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


