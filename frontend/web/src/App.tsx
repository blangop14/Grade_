import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TranscriptData {
  id: string;
  courseName: string;
  encryptedGrade: string;
  creditHours: number;
  semester: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

interface GPAStats {
  currentGPA: number;
  totalCredits: number;
  verifiedCourses: number;
  averageGrade: number;
  predictedGPA: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [transcripts, setTranscripts] = useState<TranscriptData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingTranscript, setAddingTranscript] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newTranscriptData, setNewTranscriptData] = useState({ 
    courseName: "", 
    grade: "", 
    creditHours: "1",
    semester: "Fall 2024" 
  });
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptData | null>(null);
  const [decryptedGrade, setDecryptedGrade] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSemester, setFilterSemester] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [gpaStats, setGpaStats] = useState<GPAStats>({
    currentGPA: 0,
    totalCredits: 0,
    verifiedCourses: 0,
    averageGrade: 0,
    predictedGPA: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateGPAStats();
  }, [transcripts]);

  const calculateGPAStats = () => {
    const verifiedCourses = transcripts.filter(t => t.isVerified);
    const totalCredits = verifiedCourses.reduce((sum, t) => sum + t.creditHours, 0);
    const totalGradePoints = verifiedCourses.reduce((sum, t) => sum + (t.decryptedValue || 0) * t.creditHours, 0);
    const currentGPA = totalCredits > 0 ? totalGradePoints / totalCredits : 0;
    
    const allGrades = transcripts.map(t => t.publicValue1);
    const averageGrade = allGrades.length > 0 ? allGrades.reduce((a, b) => a + b) / allGrades.length : 0;
    
    setGpaStats({
      currentGPA,
      totalCredits,
      verifiedCourses: verifiedCourses.length,
      averageGrade,
      predictedGPA: currentGPA * 0.9 + averageGrade * 0.1
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const transcriptsList: TranscriptData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          transcriptsList.push({
            id: businessId,
            courseName: businessData.name,
            encryptedGrade: businessId,
            creditHours: Number(businessData.publicValue1) || 1,
            semester: `Semester ${Number(businessData.publicValue2) || 1}`,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading transcript data:', e);
        }
      }
      
      setTranscripts(transcriptsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const addTranscript = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingTranscript(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding encrypted transcript..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const gradeValue = parseInt(newTranscriptData.grade) || 0;
      const businessId = `course-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, gradeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTranscriptData.courseName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTranscriptData.creditHours) || 1,
        1,
        `Grade for ${newTranscriptData.courseName} - ${newTranscriptData.semester}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Transcript added successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowAddModal(false);
      setNewTranscriptData({ 
        courseName: "", 
        grade: "", 
        creditHours: "1",
        semester: "Fall 2024" 
      });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingTranscript(false); 
    }
  };

  const decryptGrade = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Grade already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying grade..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Grade decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Grade already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTranscripts = transcripts.filter(transcript => {
    const matchesSearch = transcript.courseName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSemester = filterSemester === "all" || transcript.semester === filterSemester;
    return matchesSearch && matchesSemester;
  });

  const renderGPAChart = () => {
    return (
      <div className="gpa-chart">
        <div className="chart-row">
          <div className="chart-label">Current GPA</div>
          <div className="chart-bar">
            <div 
              className="bar-fill gpa" 
              style={{ width: `${Math.min(100, gpaStats.currentGPA * 10)}%` }}
            >
              <span className="bar-value">{gpaStats.currentGPA.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Predicted GPA</div>
          <div className="chart-bar">
            <div 
              className="bar-fill predicted" 
              style={{ width: `${Math.min(100, gpaStats.predictedGPA * 10)}%` }}
            >
              <span className="bar-value">{gpaStats.predictedGPA.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Verified Courses</div>
          <div className="chart-bar">
            <div 
              className="bar-fill courses" 
              style={{ width: `${Math.min(100, (gpaStats.verifiedCourses / Math.max(1, transcripts.length)) * 100)}%` }}
            >
              <span className="bar-value">{gpaStats.verifiedCourses}/{transcripts.length}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>FHE Transcript FAQ</h3>
        <div className="faq-item">
          <div className="faq-question">What is FHE encryption?</div>
          <div className="faq-answer">Fully Homomorphic Encryption allows computations on encrypted data without decryption.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How are grades protected?</div>
          <div className="faq-answer">Grades are encrypted on-chain and only decrypted with your permission.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">Can I share my transcript?</div>
          <div className="faq-answer">Yes, you can authorize third parties to verify your GPA without revealing individual grades.</div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 Confidential Academic Transcript</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🎓</div>
            <h2>Connect Your Wallet to Access Encrypted Transcript</h2>
            <p>Your academic records are protected with Zama FHE encryption technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted transcripts...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎓 Confidential Academic Transcript</h1>
          <p>FHE-Protected Grade Management</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE System
          </button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <button onClick={() => setShowAddModal(true)} className="add-btn">
            + Add Course
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        {showFAQ && renderFAQ()}
        
        <div className="stats-section">
          <h2>Academic Overview</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{gpaStats.currentGPA.toFixed(2)}</div>
              <div className="stat-label">Current GPA</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{gpaStats.totalCredits}</div>
              <div className="stat-label">Total Credits</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{gpaStats.verifiedCourses}</div>
              <div className="stat-label">Verified Courses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{transcripts.length}</div>
              <div className="stat-label">Total Courses</div>
            </div>
          </div>
          
          <div className="gpa-chart-container">
            {renderGPAChart()}
          </div>
        </div>
        
        <div className="transcripts-section">
          <div className="section-header">
            <h2>Course Transcripts</h2>
            <div className="controls">
              <input
                type="text"
                placeholder="Search courses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterSemester} 
                onChange={(e) => setFilterSemester(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Semesters</option>
                <option value="Fall 2024">Fall 2024</option>
                <option value="Spring 2024">Spring 2024</option>
                <option value="Fall 2023">Fall 2023</option>
              </select>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="transcripts-list">
            {filteredTranscripts.length === 0 ? (
              <div className="no-transcripts">
                <p>No courses found</p>
                <button onClick={() => setShowAddModal(true)} className="add-btn">
                  Add First Course
                </button>
              </div>
            ) : filteredTranscripts.map((transcript, index) => (
              <div 
                className={`transcript-card ${transcript.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedTranscript(transcript)}
              >
                <div className="course-header">
                  <div className="course-name">{transcript.courseName}</div>
                  <div className="course-credits">{transcript.creditHours} credits</div>
                </div>
                <div className="course-meta">
                  <span>{transcript.semester}</span>
                  <span>Grade: {transcript.isVerified ? 
                    `${transcript.decryptedValue} (Verified)` : "🔒 Encrypted"}</span>
                </div>
                <div className="course-status">
                  Status: {transcript.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showAddModal && (
        <ModalAddTranscript 
          onSubmit={addTranscript} 
          onClose={() => setShowAddModal(false)} 
          adding={addingTranscript} 
          transcriptData={newTranscriptData} 
          setTranscriptData={setNewTranscriptData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedTranscript && (
        <TranscriptDetailModal 
          transcript={selectedTranscript} 
          onClose={() => { 
            setSelectedTranscript(null); 
            setDecryptedGrade(null); 
          }} 
          decryptedGrade={decryptedGrade} 
          setDecryptedGrade={setDecryptedGrade} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptGrade={() => decryptGrade(selectedTranscript.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalAddTranscript: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  transcriptData: any;
  setTranscriptData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, transcriptData, setTranscriptData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'grade' || name === 'creditHours') {
      const intValue = value.replace(/[^\d]/g, '');
      setTranscriptData({ ...transcriptData, [name]: intValue });
    } else {
      setTranscriptData({ ...transcriptData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="add-transcript-modal">
        <div className="modal-header">
          <h2>Add Encrypted Course Grade</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Grade Protection 🔐</strong>
            <p>Grade value will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Course Name *</label>
            <input 
              type="text" 
              name="courseName" 
              value={transcriptData.courseName} 
              onChange={handleChange} 
              placeholder="Enter course name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Grade (0-100) *</label>
            <input 
              type="number" 
              name="grade" 
              min="0"
              max="100"
              value={transcriptData.grade} 
              onChange={handleChange} 
              placeholder="Enter grade..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Credit Hours *</label>
            <input 
              type="number" 
              name="creditHours" 
              min="1"
              max="10"
              value={transcriptData.creditHours} 
              onChange={handleChange} 
              placeholder="Credit hours..." 
            />
          </div>
          
          <div className="form-group">
            <label>Semester</label>
            <select name="semester" value={transcriptData.semester} onChange={handleChange}>
              <option value="Fall 2024">Fall 2024</option>
              <option value="Spring 2024">Spring 2024</option>
              <option value="Fall 2023">Fall 2023</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !transcriptData.courseName || !transcriptData.grade} 
            className="submit-btn"
          >
            {adding || isEncrypting ? "Encrypting..." : "Add Course"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TranscriptDetailModal: React.FC<{
  transcript: TranscriptData;
  onClose: () => void;
  decryptedGrade: number | null;
  setDecryptedGrade: (value: number | null) => void;
  isDecrypting: boolean;
  decryptGrade: () => Promise<number | null>;
}> = ({ transcript, onClose, decryptedGrade, setDecryptedGrade, isDecrypting, decryptGrade }) => {
  const handleDecrypt = async () => {
    if (decryptedGrade !== null) { 
      setDecryptedGrade(null); 
      return; 
    }
    
    const decrypted = await decryptGrade();
    if (decrypted !== null) {
      setDecryptedGrade(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="transcript-detail-modal">
        <div className="modal-header">
          <h2>Course Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="transcript-info">
            <div className="info-item">
              <span>Course:</span>
              <strong>{transcript.courseName}</strong>
            </div>
            <div className="info-item">
              <span>Semester:</span>
              <strong>{transcript.semester}</strong>
            </div>
            <div className="info-item">
              <span>Credit Hours:</span>
              <strong>{transcript.creditHours}</strong>
            </div>
          </div>
          
          <div className="grade-section">
            <h3>Encrypted Grade</h3>
            
            <div className="grade-display">
              <div className="grade-value">
                {transcript.isVerified ? 
                  `${transcript.decryptedValue}` : 
                  decryptedGrade !== null ? 
                  `${decryptedGrade}` : 
                  "🔒"
                }
              </div>
              <div className="grade-status">
                {transcript.isVerified ? "On-chain Verified" : 
                 decryptedGrade !== null ? "Locally Decrypted" : "FHE Encrypted"}
              </div>
            </div>
            
            <button 
              className={`decrypt-btn ${(transcript.isVerified || decryptedGrade !== null) ? 'decrypted' : ''}`}
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." :
               transcript.isVerified ? "✅ Verified" :
               decryptedGrade !== null ? "🔄 Re-verify" : "🔓 Verify Grade"}
            </button>
          </div>
          
          <div className="fhe-info">
            <div className="fhe-icon">🔐</div>
            <div>
              <strong>FHE Grade Protection</strong>
              <p>Your grade is encrypted on-chain. Verification performs offline decryption with on-chain proof validation.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


