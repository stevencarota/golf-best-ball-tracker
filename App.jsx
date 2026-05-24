import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// ==========================================
// 🧮 AUTO-OPTIMIZATION GOLF ALGORITHM
// ==========================================
function calculateOptimizedTeamScore(holeScores, minContribution = 6) {
  const totalHolesPlayed = holeScores.filter(h => h.player_a_strokes !== null || h.player_b_strokes !== null).length;
  
  let bestTotalStrokes = Infinity;
  let bestPlayerACount = 0;
  let bestPlayerBCount = 0;

  function branchAndBound(holeIndex, currentStrokes, countA, countB) {
    if (currentStrokes >= bestTotalStrokes) return;

    if (holeIndex === holeScores.length) {
      const holesRemaining = 18 - totalHolesPlayed;
      const canAFinish = (countA + holesRemaining) >= minContribution;
      const canBFinish = (countB + holesRemaining) >= minContribution;

      if (totalHolesPlayed === 18 && (countA < minContribution || countB < minContribution)) return;
      if (!canAFinish || !canBFinish) return;

      if (currentStrokes < bestTotalStrokes) {
        bestTotalStrokes = currentStrokes;
        bestPlayerACount = countA;
        bestPlayerBCount = countB;
      }
      return;
    }

    const hole = holeScores[holeIndex];

    // If a hole hasn't been played by either player, skip it gracefully
    if (hole.player_a_strokes === null && hole.player_b_strokes === null) {
      branchAndBound(holeIndex + 1, currentStrokes, countA, countB);
      return;
    }

    // Try Player A's score if it exists
    if (hole.player_a_strokes !== null) {
      branchAndBound(holeIndex + 1, currentStrokes + hole.player_a_strokes, countA + 1, countB);
    }
    // Try Player B's score if it exists
    if (hole.player_b_strokes !== null) {
      branchAndBound(holeIndex + 1, currentStrokes + hole.player_b_strokes, countA, countB + 1);
    }
  }

  branchAndBound(0, 0, 0, 0);

  const totalParPlayed = holeScores.reduce((sum, h) => sum + (h.player_a_strokes !== null || h.player_b_strokes !== null ? h.par : 0), 0);
  const relativeToPar = bestTotalStrokes === Infinity ? 0 : bestTotalStrokes - totalParPlayed;

  return {
    totalStrokes: bestTotalStrokes === Infinity ? 0 : bestTotalStrokes,
    relativeToPar: relativeToPar,
    thru: totalHolesPlayed,
    playerAUsed: bestPlayerACount,
    playerBUsed: bestPlayerBCount
  };
}

// ==========================================
// 💻 CORE APP COMPONENT
// ==========================================
export default function App() {
  const [view, setView] = useState('leaderboard'); // 'leaderboard' or 'entry'
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [leaderboardData, setLeaderboardData] = useState([]);

  // Form States
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [holeNumber, setHoleNumber] = useState(1);
  const [strokes, setStrokes] = useState(4);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // 1. Initial Data Load
  useEffect(() => {
    async function initFetch() {
      const { data: teamsData } = await supabase.from('teams').select('*').order('team_name');
      const { data: playersData } = await supabase.from('players').select('*').order('player_name');
      setTeams(teamsData || []);
      setPlayers(playersData || []);
    }
    initFetch();
    fetchLeaderboard();
  }, []);

  // 2. Fetch Matrix & Calculate Leaderboard
  const fetchLeaderboard = async () => {
    const { data: matrix, error } = await supabase.from('team_hole_scores_matrix').select('*');
    if (error || !matrix) return;

    // Group the raw database view items by team ID
    const groupedByTeam = matrix.reduce((acc, row) => {
      if (!acc[row.team_id]) acc[row.team_id] = { name: row.team_name, scores: [] };
      acc[row.team_id].scores.push(row);
      return acc;
    }, {});

    // Run each team's scorecard through the optimization algorithm
    const calculated = Object.keys(groupedByTeam).map(teamId => {
      const team = groupedByTeam[teamId];
      const stats = calculateOptimizedTeamScore(team.scores);
      return { id: teamId, name: team.name, ...stats };
    });

    // Sort leaderboard by best score relative to par
    calculated.sort((a, b) => a.relativeToPar - b.relativeToPar);
    setLeaderboardData(calculated);
  };

  // 3. Set Up Real-Time Live Scoring Listener
  useEffect(() => {
    const channel = supabase
      .channel('live-scores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => {
        fetchLeaderboard(); // Automatically recalculate everything live when a row drops in
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Filter players drop-down when team changes
  useEffect(() => {
    if (selectedTeam) {
      setFilteredPlayers(players.filter(p => p.team_id === selectedTeam));
      setSelectedPlayer('');
    } else {
      setFilteredPlayers([]);
    }
  }, [selectedTeam, players]);

  // Handle Score Submission
  const handleScoreSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlayer || !holeNumber || !strokes) return;
    setLoading(true);
    setMessage({ type: '', text: '' });

    const { error } = await supabase.from('scores').upsert({
      player_id: selectedPlayer,
      hole_number: parseInt(holeNumber),
      strokes: parseInt(strokes)
    }, { onConflict: 'player_id,hole_number' });

    setLoading(false);
    if (error) {
      setMessage({ type: 'error', text: 'Error saving score.' });
    } else {
      setMessage({ type: 'success', text: `Saved! Advanced to next hole. ✅` });
      if (holeNumber < 18) {
        setHoleNumber(prev => prev + 1);
        setStrokes(4);
      }
    }
  };

  return (
    <div style={styles.container}>
      {/* Tab Navigation */}
      <nav style={styles.nav}>
        <button onClick={() => { setView('leaderboard'); fetchLeaderboard(); }} style={{ ...styles.navBtn, fontWeight: view === 'leaderboard' ? 'bold' : 'normal', borderBottom: view === 'leaderboard' ? '3px solid #1e3a8a' : 'none' }}>📊 Leaderboard</button>
        <button onClick={() => setView('entry')} style={{ ...styles.navBtn, fontWeight: view === 'entry' ? 'bold' : 'normal', borderBottom: view === 'entry' ? '3px solid #1e3a8a' : 'none' }}>✏️ Enter Scores</button>
      </nav>

      {/* VIEW 1: THE LIVE LEADERBOARD */}
      {view === 'leaderboard' && (
        <div>
          <h2 style={styles.viewTitle}>Live Leaderboard</h2>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thRow}>
                  <th style={styles.th}>Team</th>
                  <th style={styles.th}>Par</th>
                  <th style={styles.th}>Thru</th>
                  <th style={styles.th}>Used A/B</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardData.map(team => (
                  <tr key={team.id} style={styles.tr}>
                    <td style={styles.tdBold}>{team.name}</td>
                    <td style={{ ...styles.tdBold, color: team.relativeToPar < 0 ? '#dc2626' : team.relativeToPar > 0 ? '#334155' : '#166534' }}>
                      {team.relativeToPar === 0 ? 'E' : team.relativeToPar > 0 ? `+${team.relativeToPar}` : team.relativeToPar}
                    </td>
                    <td style={styles.td}>{team.thru}</td>
                    <td style={styles.tdSub}>
                      {team.playerAUsed} / {team.playerBUsed} 
                      {(team.thru > 12 && (team.playerAUsed < 6 || team.playerBUsed < 6)) && ' ⚠️'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 2: SCORE ENTRY SYSTEM */}
      {view === 'entry' && (
        <form onSubmit={handleScoreSubmit} style={styles.card}>
          <h2 style={styles.viewTitle}>Submit Hole Score</h2>
          {message.text && (
            <div style={{ ...styles.alert, backgroundColor: message.type === 'error' ? '#fee2e2' : '#dcfce7', color: message.type === 'error' ? '#991b1b' : '#166534' }}>
              {message.text}
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>Team</label>
            <select style={styles.select} value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
              <option value="">-- Select Team --</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.team_name}</option>)}
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Player Name</label>
            <select style={styles.select} value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)} disabled={!selectedTeam}>
              <option value="">-- Select Player --</option>
              {filteredPlayers.map(p => <option key={p.id} value={p.id}>{p.player_name}</option>)}
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Hole</label>
            <select style={styles.select} value={holeNumber} onChange={(e) => setHoleNumber(e.target.value)}>
              {Array.from({ length: 18 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Hole {n} (Par 4)</option>)}
            </select>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Strokes</label>
            <div style={styles.stepper}>
              <button type="button" onClick={() => setStrokes(s => Math.max(1, s - 1))} style={styles.stepBtn}>-</button>
              <span style={styles.stepVal}>{strokes}</span>
              <button type="button" onClick={() => setStrokes(s => s + 1)} style={styles.stepBtn}>+</button>
            </div>
          </div>

          <button type="submit" disabled={loading} style={styles.submitBtn}>{loading ? 'Saving...' : 'Submit'}</button>
        </form>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: '480px', margin: '0 auto', padding: '12px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh' },
  nav: { display: 'flex', justifyContent: 'space-around', backgroundColor: '#fff', borderRadius: '8px', padding: '6px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  navBtn: { border: 'none', background: 'none', padding: '10px 20px', fontSize: '15px', cursor: 'pointer', color: '#334155' },
  viewTitle: { fontSize: '20px', color: '#1e3a8a', marginTop: '4px', marginBottom: '16px', textAlign: 'center', fontWeight: '700' },
  card: { backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' },
  inputGroup: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '4px' },
  select: { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '16px', backgroundColor: '#fff' },
  stepper: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff' },
  stepBtn: { width: '64px', height: '44px', fontSize: '20px', border: 'none', backgroundColor: '#f1f5f9', color: '#334155', cursor: 'pointer' },
  stepVal: { fontSize: '20px', fontWeight: '700', color: '#1e3a8a' },
  submitBtn: { width: '100%', padding: '14px', backgroundColor: '#1e3a8a', color: '#fff', fontSize: '16px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '8px' },
  tableWrapper: { backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left' },
  thRow: { backgroundColor: '#f1f5f9' },
  th: { padding: '12px', fontSize: '13px', fontWeight: '600', color: '#475569' },
  tr: { borderBottom: '1px solid #e2e8f0' },
  tdBold: { padding: '14px 12px', fontSize: '15px', fontWeight: '700', color: '#1e293b' },
  td: { padding: '14px 12px', fontSize: '15px', color: '#334155' },
  tdSub: { padding: '14px 12px', fontSize: '13px', color: '#64748b' },
  alert: { padding: '10px', borderRadius: '6px', fontSize: '13px', fontWeight: '500', marginBottom: '14px', textAlign: 'center' }
};
