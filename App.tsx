import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { GroupScreen } from './src/screens/GroupScreen';
import { ReceiptScreen } from './src/screens/ReceiptScreen';
import { ItemsScreen } from './src/screens/ItemsScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { PricingScreen } from './src/screens/PricingScreen';
import { mockReceipt } from './src/data/mockReceipt';
import { Person, ReceiptDraft } from './src/types';

type Step = 'welcome' | 'group' | 'receipt' | 'items' | 'summary' | 'pricing';

const emptyReceipt: ReceiptDraft = {
  merchant: '',
  date: new Date().toISOString().slice(0, 10),
  total: 0,
  lineItems: []
};

const initialPeople: Person[] = [
  { id: 'me', name: 'You', phone: '' }
];

const demoPeople: Person[] = [
  { id: 'me', name: 'You', phone: '', paymentPrefs: { method: 'VENMO', handle: '@you' } },
  { id: 'p-alex', name: 'Alex' },
  { id: 'p-sam', name: 'Sam' }
];

// Error Boundary to catch and display crashes
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#f6f1ea' }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#b91c1c', marginBottom: 12 }}>
            App Crashed
          </Text>
          <Text style={{ fontSize: 14, color: '#1c1c1c', textAlign: 'center' }}>
            {this.state.error.message}
          </Text>
          <Text style={{ fontSize: 12, color: '#6b6b6b', marginTop: 12, textAlign: 'center' }}>
            {this.state.error.stack?.substring(0, 500)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [step, setStep] = useState<Step>('welcome');
  const [groupName, setGroupName] = useState('');
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [payerId, setPayerId] = useState('me');
  const [receipt, setReceipt] = useState<ReceiptDraft>(emptyReceipt);

  const handleStartOver = () => {
    setStep('welcome');
    setGroupName('');
    setPeople(initialPeople);
    setPayerId('me');
    setReceipt(emptyReceipt);
  };

  const handleTryDemo = () => {
    // Pre-fill with demo data so the user can explore the full flow
    setGroupName('Friday Dinner');
    setPeople(demoPeople);
    setPayerId('me');
    setReceipt({
      ...mockReceipt,
      lineItems: mockReceipt.lineItems.map((item) => ({
        ...item,
        allocatedTo: []
      }))
    });
    setStep('items');
  };

  const handleReceiptProcessed = (draft: ReceiptDraft, imageUri: string) => {
    setReceipt({ ...draft, imageUri });
    setStep('items');
  };

  const handleSkipReceipt = () => {
    // Go to items with an empty receipt so the user can add items manually
    setReceipt({
      ...emptyReceipt,
      merchant: groupName || 'My Receipt',
      lineItems: [{ id: `li-${Date.now()}`, name: 'New item', price: 0, allocatedTo: [] }]
    });
    setStep('items');
  };

  switch (step) {
    case 'welcome':
      return (
        <WelcomeScreen
          onStart={() => setStep('group')}
          onTryDemo={handleTryDemo}
          onPricing={() => setStep('pricing')}
          onHome={() => setStep('welcome')}
        />
      );

    case 'group':
      return (
        <GroupScreen
          groupName={groupName}
          setGroupName={setGroupName}
          people={people}
          setPeople={setPeople}
          payerId={payerId}
          setPayerId={setPayerId}
          onNext={() => setStep('receipt')}
          onBack={() => setStep('welcome')}
        />
      );

    case 'receipt':
      return (
        <ReceiptScreen
          onReceiptProcessed={handleReceiptProcessed}
          onSkip={handleSkipReceipt}
          onBack={() => setStep('group')}
        />
      );

    case 'items':
      return (
        <ItemsScreen
          receipt={receipt}
          setReceipt={setReceipt}
          people={people}
          onNext={() => setStep('summary')}
          onBack={() => setStep('receipt')}
        />
      );

    case 'summary':
      return (
        <SummaryScreen
          groupName={groupName}
          receipt={receipt}
          people={people}
          payerId={payerId}
          onStartOver={handleStartOver}
          onBack={() => setStep('items')}
        />
      );

    case 'pricing':
      return (
        <PricingScreen
          onStart={() => setStep('group')}
          onHome={() => setStep('welcome')}
          onTryDemo={handleTryDemo}
          onPricing={() => setStep('pricing')}
        />
      );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
