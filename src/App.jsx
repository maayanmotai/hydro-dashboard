import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { format, subDays, isAfter, differenceInMinutes } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Droplet, Thermometer, AlertTriangle, CheckCircle, WifiOff } from 'lucide-react'

function App() {
  const [data, setData] = useState([])
  const [currentStatus, setCurrentStatus] = useState(null)
  const [timeRange, setTimeRange] = useState('day')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    fetchData()
    
    // Subscribe to new data insertions in real-time
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hydro_data' }, payload => {
        setData(prev => [...prev, payload.new])
        setCurrentStatus(payload.new)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function fetchData() {
    let { data: hydroData, error } = await supabase
      .from('hydro_data')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) console.log('error', error)
    else {
      setData(hydroData)
      if (hydroData.length > 0) {
        setCurrentStatus(hydroData[hydroData.length - 1])
      }
    }
  }

  // Filter and format data for chart
  const filteredData = data.filter(item => {
    if (!item.created_at) return false;
    const date = new Date(item.created_at)
    const now = new Date()
    if (timeRange === 'day') return isAfter(date, subDays(now, 1))
    if (timeRange === 'week') return isAfter(date, subDays(now, 7))
    if (timeRange === 'month') return isAfter(date, subDays(now, 30))
    return true
  }).map(item => ({
    ...item,
    formattedTime: format(new Date(item.created_at), timeRange === 'day' ? 'HH:mm' : 'MMM dd HH:mm')
  }))

  const isWaterAlert = currentStatus?.water_level !== 'OK'
  const isOffline = currentStatus?.created_at 
    ? differenceInMinutes(now, new Date(currentStatus.created_at)) >= 5 
    : false;

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6 text-gray-800">
      <header className="flex items-center justify-between pb-4 border-b">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Droplet className="text-blue-500" size={32} />
          Hydro Dashboard
        </h1>
        <div className="text-sm text-gray-500">
          Last updated: {currentStatus?.created_at ? format(new Date(currentStatus.created_at), 'HH:mm:ss') : 'Loading...'}
        </div>
      </header>

      {/* Offline Alert Banner */}
      {isOffline && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <WifiOff size={28} />
          <div>
            <p className="font-bold">מערכת מנותקת / הפסקת חשמל</p>
            <p className="text-sm">לא התקבלו נתונים מהבקר ב-5 הדקות האחרונות. אנא בדוק חיבור לחשמל ול-WiFi.</p>
          </div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Temperature Card */}
        <div className="bg-white rounded-xl shadow p-6 flex flex-col justify-center items-center gap-4">
          <div className="flex items-center gap-2 text-xl font-medium text-gray-600">
            <Thermometer size={28} className="text-orange-500" />
            Water Temperature
          </div>
          <div className="text-6xl font-bold">
            {currentStatus?.temperature != null ? `${currentStatus.temperature.toFixed(1)}°` : '--'}
          </div>
        </div>

        {/* Water Level Card */}
        <div className={`rounded-xl shadow p-6 flex flex-col justify-center items-center gap-4 text-white ${isWaterAlert ? 'bg-red-500' : 'bg-green-500'}`}>
          <div className="flex items-center gap-2 text-xl font-medium">
            <Droplet size={28} />
            Water Level
          </div>
          <div className="text-4xl font-bold flex items-center gap-3">
            {isWaterAlert ? (
              <><AlertTriangle size={36} /> Missing Water!</>
            ) : (
              <><CheckCircle size={36} /> Optimal</>
            )}
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-white rounded-xl shadow p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">Temperature History</h2>
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {['day', 'week', 'month', 'all'].map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-1 rounded-md text-sm font-medium capitalize transition-colors ${timeRange === range ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filteredData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.5} />
              <XAxis dataKey="formattedTime" />
              <YAxis domain={['auto', 'auto']} tickFormatter={(value) => `${value}°`} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                labelStyle={{ fontWeight: 'bold', color: '#374151' }}
              />
              <Line 
                type="monotone" 
                dataKey="temperature" 
                stroke="#3b82f6" 
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 8 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  )
}

export default App
